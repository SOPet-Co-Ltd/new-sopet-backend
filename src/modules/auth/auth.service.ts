import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Customer } from '../../database/entities/customer.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { pickDefaultAccessibleStoreId } from '../stores/store-selection.util';
import { OtpCode, OtpPurpose } from '../../database/entities/otp-code.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { EmailVerificationToken } from '../../database/entities/email-verification-token.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { SendOtpDto, VerifyOtpDto, LoginDto } from './dto';
import { JwtPayload } from '../../common/interfaces';
import { normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { SmsService } from '../sms/sms.service';
import { CartService } from '../cart/cart.service';
import { GuestOrderLinkService } from '../orders/guest-order-link.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { RedisService } from '../redis/redis.service';
import {
  finalizeCustomerDeletion,
  isAdminSuspended,
  isDeletionRetentionExpired,
  isPendingDeletion,
} from '../customers/customer-deletion.util';

interface ReactivationJwtPayload {
  sub: string;
  purpose: 'reactivation';
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_REQUESTS_PER_WINDOW = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    private readonly customerRepo: CustomerRepository,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OtpCode)
    private readonly otpRepository: Repository<OtpCode>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreMember)
    private readonly storeMemberRepository: Repository<StoreMember>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(EmailVerificationToken)
    private readonly emailVerificationTokenRepository: Repository<EmailVerificationToken>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly smsService: SmsService,
    private readonly cartService: CartService,
    private readonly guestOrderLinkService: GuestOrderLinkService,
    private readonly emailDeliveryService: EmailDeliveryService,
    private readonly storageService: StorageService,
    private readonly auditLogsService: AuditLogsService,
    private readonly redisService: RedisService,
  ) {}

  private generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  }

  /** HMAC-SHA256 hex digest; plaintext OTP is never persisted. */
  private hashOtp(code: string): string {
    const secret = this.configService.get<string>('jwt.secret');
    if (!secret) {
      throw new Error('JWT_SECRET is required to hash OTP codes');
    }
    return createHmac('sha256', secret).update(code).digest('hex');
  }

  private otpHashesMatch(storedHash: string, providedCode: string): boolean {
    const providedHash = this.hashOtp(providedCode);
    const stored = Buffer.from(storedHash, 'utf8');
    const provided = Buffer.from(providedHash, 'utf8');
    if (stored.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(stored, provided);
  }

  private isOtpExpired(expiresAt: Date | string | null | undefined): boolean {
    if (!expiresAt) {
      return true;
    }
    const expiresMs = new Date(expiresAt).getTime();
    return Number.isNaN(expiresMs) || expiresMs <= Date.now();
  }

  async sendOtp(sendOtpDto: SendOtpDto): Promise<{ message: string }> {
    const phone = normalizeThaiPhoneToLocal(sendOtpDto.phone);

    // Rate limit: max 3 attempts per 5 minutes
    const recentAttempts = await this.otpRepository.count({
      where: {
        phone,
        createdAt: MoreThan(new Date(Date.now() - OTP_TTL_MS)),
      },
    });

    if (recentAttempts >= OTP_MAX_REQUESTS_PER_WINDOW) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many OTP requests. Please try again in 5 minutes.',
      });
    }

    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Only the newest OTP should work; mark prior unused codes as used.
    await this.otpRepository.update({ phone, isUsed: false }, { isUsed: true });

    const otp = this.otpRepository.create({
      phone,
      code: this.hashOtp(code),
      purpose: OtpPurpose.LOGIN,
      expiresAt,
    });
    await this.otpRepository.save(otp);

    await this.smsService.sendOtp(phone, code);

    return {
      message: 'OTP sent successfully',
    };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto & { sessionId?: string }): Promise<{
    accessToken?: string;
    refreshToken?: string;
    customer: Partial<Customer>;
    pendingDeletion?: boolean;
    reactivationToken?: string;
  }> {
    const { code, sessionId } = verifyOtpDto;
    const phone = normalizeThaiPhoneToLocal(verifyOtpDto.phone);

    const otp = await this.otpRepository.findOne({
      where: {
        phone,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
    });

    if (!otp || this.isOtpExpired(otp.expiresAt) || !this.otpHashesMatch(otp.code, code)) {
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid or expired OTP code',
      });
    }

    otp.isUsed = true;
    await this.otpRepository.save(otp);

    let customer = await this.customerRepo.findActiveByPhone(phone);

    if (customer) {
      if (!customer.isActive) {
        if (isPendingDeletion(customer)) {
          if (isDeletionRetentionExpired(customer.deletionRequestedAt!)) {
            await finalizeCustomerDeletion(this.customerRepository, customer.id);
            customer = null;
          } else {
            const reactivationToken = await this.jwtService.signAsync(
              { sub: customer.id, purpose: 'reactivation' } satisfies ReactivationJwtPayload,
              { expiresIn: '1h' },
            );

            return {
              customer: {
                id: customer.id,
                phone: customer.phone,
                fullName: customer.fullName,
                email: customer.email,
                profilePhotoUrl: customer.profilePhotoUrl,
                dateOfBirth: customer.dateOfBirth,
              },
              pendingDeletion: true,
              reactivationToken,
            };
          }
        } else if (isAdminSuspended(customer)) {
          throw new ForbiddenException({
            code: 'CUSTOMER_SUSPENDED',
            message: 'Your account has been suspended. Please contact support for assistance.',
          });
        }
      }
    }

    if (!customer) {
      customer = this.customerRepository.create({
        phone,
        isVerified: true,
      });
      await this.customerRepository.save(customer);
    } else {
      customer.isVerified = true;
      customer.lastLoginAt = new Date();
      await this.customerRepository.save(customer);
    }

    const { accessToken, refreshToken } = await this.generateTokens({
      sub: customer.id,
      phone: customer.phone,
      role: 'customer',
    });

    if (sessionId) {
      await this.cartService.mergeGuestCart(customer.id, sessionId);
    }

    await this.guestOrderLinkService.mergeGuestOrders(customer.id, phone);

    return {
      accessToken,
      refreshToken,
      customer: {
        id: customer.id,
        phone: customer.phone,
        fullName: customer.fullName,
        email: customer.email,
        profilePhotoUrl: customer.profilePhotoUrl,
        dateOfBirth: customer.dateOfBirth,
      },
    };
  }

  async login(
    loginDto: LoginDto,
    req?: unknown,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Partial<User>;
  }> {
    const { email, password } = loginDto;

    // Look up by email only — do not filter isActive here, or suspended
    // accounts collapse into INVALID_CREDENTIALS before password is checked.
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['ownedStores'],
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      // Same generic code whether the account is active or suspended —
      // do not leak existence / suspension status on wrong password.
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact support for assistance.',
      });
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const payload: Omit<JwtPayload, 'type'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword === true,
    };

    // Vendors: prefer owned store, then team memberships
    if (user.role === UserRole.VENDOR) {
      const storeId = await this.resolveDefaultStoreId(user.id);
      if (storeId) {
        payload.storeId = storeId;
      }
    }

    const { accessToken, refreshToken } = await this.generateTokens(payload);

    const actorType =
      user.role === UserRole.ADMIN
        ? AuditActorType.ADMIN
        : user.role === UserRole.VENDOR
          ? AuditActorType.VENDOR
          : AuditActorType.SYSTEM;

    await this.auditLogsService.log({
      actorType,
      actorId: user.id,
      actorLabel: user.fullName || user.email,
      action: AuditAction.LOGIN,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: { role: user.role },
      ...getAuditRequestContext(req),
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        profilePhotoUrl: user.profilePhotoUrl,
        emailVerified: user.emailVerified,
        mustChangePassword: user.mustChangePassword === true,
      },
    };
  }

  async refreshToken(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      if (payload.jti) {
        await this.assertRefreshTokenJtiValid(payload.jti, payload.sub);
        await this.invalidateRefreshTokenJti(payload.jti);
      }

      const newPayload: Omit<JwtPayload, 'type' | 'jti'> = {
        sub: payload.sub,
        email: payload.email,
        phone: payload.phone,
        role: payload.role,
        storeId: payload.storeId,
        mustChangePassword: payload.mustChangePassword,
      };

      if (payload.role === UserRole.CUSTOMER) {
        const customer = await this.customerRepository.findOne({
          where: { id: payload.sub },
          select: ['id', 'isActive'],
        });
        if (!customer || !customer.isActive) {
          throw new UnauthorizedException({
            code: 'CUSTOMER_SUSPENDED',
            message: 'Your account has been suspended. Please contact support for assistance.',
          });
        }
      }

      if (payload.role === UserRole.VENDOR || payload.role === UserRole.ADMIN) {
        const user = await this.userRepository.findOne({
          where: { id: payload.sub },
          select: ['id', 'isActive', 'mustChangePassword'],
        });
        if (!user || !user.isActive) {
          throw new UnauthorizedException({
            code: 'ACCOUNT_SUSPENDED',
            message: 'Your account has been suspended. Please contact support for assistance.',
          });
        }
        if (payload.role === UserRole.ADMIN) {
          newPayload.mustChangePassword = user.mustChangePassword === true;
        }
      }

      return this.generateTokens(newPayload);
    } catch (error) {
      if (this.isSuspensionAuthError(error)) {
        throw error;
      }
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
  }

  private refreshTokenRedisKey(jti: string): string {
    return `refresh:jti:${jti}`;
  }

  private refreshRevokedRedisKey(sub: string): string {
    return `refresh:revoked:${sub}`;
  }

  private getRefreshTtlSeconds(): number {
    const configured = this.configService.get<string>('jwt.refreshTokenExpiresIn') ?? '7d';
    const match = /^(\d+)([smhd])$/.exec(configured);
    if (!match) {
      return 7 * 24 * 60 * 60;
    }
    const amount = Number.parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return amount;
      case 'm':
        return amount * 60;
      case 'h':
        return amount * 60 * 60;
      case 'd':
        return amount * 24 * 60 * 60;
      default:
        return 7 * 24 * 60 * 60;
    }
  }

  private async assertRefreshTokenJtiValid(jti: string, sub: string): Promise<void> {
    if (await this.isRefreshSessionRevoked(sub)) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REVOKED',
        message: 'Refresh token has been revoked',
      });
    }

    if (!this.redisService.isAvailable()) {
      return;
    }

    const storedSub = await this.redisService.get(this.refreshTokenRedisKey(jti));
    if (!storedSub) {
      await this.revokeAllRefreshSessions(sub);
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_REUSE',
        message: 'Refresh token reuse detected — all sessions revoked',
      });
    }

    if (storedSub !== sub) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
  }

  private async invalidateRefreshTokenJti(jti: string): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }
    await this.redisService.del(this.refreshTokenRedisKey(jti));
  }

  private async storeRefreshTokenJti(jti: string, sub: string): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }
    await this.redisService.set(this.refreshTokenRedisKey(jti), sub, this.getRefreshTtlSeconds());
  }

  private async isRefreshSessionRevoked(sub: string): Promise<boolean> {
    if (!this.redisService.isAvailable()) {
      return false;
    }
    const revoked = await this.redisService.get(this.refreshRevokedRedisKey(sub));
    return revoked === '1';
  }

  private async revokeAllRefreshSessions(sub: string): Promise<void> {
    if (!this.redisService.isAvailable()) {
      return;
    }
    await this.redisService.set(this.refreshRevokedRedisKey(sub), '1', this.getRefreshTtlSeconds());
  }

  private isSuspensionAuthError(error: unknown): boolean {
    if (!(error instanceof UnauthorizedException || error instanceof ForbiddenException)) {
      return false;
    }
    const response = error.getResponse();
    if (typeof response !== 'object' || response === null || !('code' in response)) {
      return false;
    }
    const code = (response as { code?: string }).code;
    return code === 'CUSTOMER_SUSPENDED' || code === 'ACCOUNT_SUSPENDED';
  }

  private async generateTokens(
    payload: Omit<JwtPayload, 'type' | 'jti'>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const refreshJti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, type: 'access' },
        {
          expiresIn: this.configService.get<string>('jwt.accessTokenExpiresIn'),
        },
      ),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh', jti: refreshJti },
        {
          expiresIn: this.configService.get<string>('jwt.refreshTokenExpiresIn'),
        },
      ),
    ]);

    await this.storeRefreshTokenJti(refreshJti, payload.sub);

    return { accessToken, refreshToken };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async getMe(userId: string, role: string): Promise<{ customer?: Customer; user?: User }> {
    if (role === UserRole.CUSTOMER) {
      const customer = await this.customerRepository.findOne({
        where: { id: userId },
      });
      if (!customer) {
        throw new UnauthorizedException({
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found',
        });
      }
      if (!customer.isActive) {
        throw new ForbiddenException({
          code: 'CUSTOMER_SUSPENDED',
          message: 'Your account has been suspended. Please contact support for assistance.',
        });
      }
      return { customer };
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    if (!user.isActive) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact support for assistance.',
      });
    }
    return { user };
  }

  async switchStore(
    userId: string,
    storeId: string,
  ): Promise<{ accessToken: string; refreshToken: string; user: Partial<User> }> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.role !== UserRole.VENDOR) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only vendor accounts can switch stores',
      });
    }

    const hasAccess = await this.userHasStoreAccess(userId, storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this store',
      });
    }

    // Suspended stores are allowed as the active JWT store so vendors can enter
    // read-only (banner + reactivation). Mutations remain blocked by StoreStatusGuard.

    const payload: Omit<JwtPayload, 'type'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      storeId,
    };

    const { accessToken, refreshToken } = await this.generateTokens(payload);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        profilePhotoUrl: user.profilePhotoUrl,
      },
    };
  }

  private async resolveDefaultStoreId(userId: string): Promise<string | undefined> {
    const ownedStores = await this.storeRepository.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
    });

    const memberships = await this.storeMemberRepository.find({
      where: { userId },
      relations: ['store'],
      order: { createdAt: 'ASC' },
    });

    const stores: Store[] = [...ownedStores];
    for (const membership of memberships) {
      if (membership.store && !stores.some((store) => store.id === membership.store.id)) {
        stores.push(membership.store);
      }
    }

    return pickDefaultAccessibleStoreId(stores);
  }

  private async userHasStoreAccess(userId: string, storeId: string): Promise<boolean> {
    const owned = await this.storeRepository.findOne({
      where: { id: storeId, ownerId: userId },
    });
    if (owned) {
      return true;
    }

    const membership = await this.storeMemberRepository.findOne({
      where: { storeId, userId },
    });
    return !!membership;
  }

  async updateUserProfile(
    userId: string,
    data: { fullName?: string; profilePhotoUrl?: string | null },
  ): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (data.fullName !== undefined) {
      user.fullName = data.fullName;
    }

    if (data.profilePhotoUrl !== undefined) {
      const trimmedUrl = data.profilePhotoUrl?.trim() || null;
      if (trimmedUrl) {
        this.storageService.assertFolderImageUrl(trimmedUrl, 'profiles');
      }
      user.profilePhotoUrl = trimmedUrl;
    }

    return this.userRepository.save(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Current password is incorrect',
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await this.userRepository.save(user);
  }

  async requestPasswordReset(email: string, req?: unknown): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail, isActive: true },
    });

    if (user) {
      await this.createAndSendPasswordResetToken(user, undefined, req);
    }

    return {
      message: 'If an account exists for this email, a password reset link has been sent',
    };
  }

  /**
   * Public, side-effect-free preview so the reset-password page can show an
   * "expired/already used" message immediately on load instead of only discovering
   * an invalid token when the user submits a new password (row 33 regression).
   */
  async getPasswordResetTokenStatus(
    token: string,
  ): Promise<{ valid: boolean; status: 'valid' | 'expired' | 'used' | 'invalid' }> {
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token },
    });

    if (!resetToken) {
      return { valid: false, status: 'invalid' };
    }
    if (resetToken.usedAt) {
      return { valid: false, status: 'used' };
    }
    if (resetToken.expiresAt < new Date()) {
      return { valid: false, status: 'expired' };
    }

    return { valid: true, status: 'valid' };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const resetToken = await this.passwordResetTokenRepository.findOne({
      where: { token },
    });

    if (!resetToken || resetToken.usedAt) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    if (resetToken.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: 'Reset token has expired',
      });
    }

    const user = await this.userRepository.findOne({
      where: { email: resetToken.email, isActive: true },
    });
    if (!user) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    await this.userRepository.save(user);

    resetToken.usedAt = new Date();
    await this.passwordResetTokenRepository.save(resetToken);

    // Defense in depth: invalidate any other unused tokens for this email.
    await this.passwordResetTokenRepository
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('email = :email', { email: user.email })
      .andWhere('used_at IS NULL')
      .execute();

    return { message: 'Password reset successfully' };
  }

  async adminTriggerVendorPasswordReset(
    vendorId: string,
    admin?: { id: string; fullName?: string },
    req?: unknown,
  ): Promise<{ message: string }> {
    const vendor = await this.userRepository.findOne({
      where: { id: vendorId, role: UserRole.VENDOR, isActive: true },
    });

    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }

    await this.createAndSendPasswordResetToken(
      vendor,
      {
        actorType: AuditActorType.ADMIN,
        actorId: admin?.id,
        actorLabel: admin?.fullName,
      },
      req,
    );

    return {
      message: 'Password reset email sent to vendor',
    };
  }

  private async createAndSendPasswordResetToken(
    user: User,
    triggeredBy?: { actorType: AuditActorType; actorId?: string; actorLabel?: string },
    req?: unknown,
  ): Promise<void> {
    // Only the newest reset link should work (row 34): mark prior unused tokens used.
    await this.passwordResetTokenRepository
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('email = :email', { email: user.email })
      .andWhere('used_at IS NULL')
      .execute();

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const resetToken = this.passwordResetTokenRepository.create({
      email: user.email,
      token,
      expiresAt,
    });
    await this.passwordResetTokenRepository.save(resetToken);
    await this.emailDeliveryService.sendPasswordReset(user.email, token);

    await this.auditLogsService.log({
      actorType: triggeredBy?.actorType ?? AuditActorType.SYSTEM,
      actorId: triggeredBy?.actorId ?? null,
      actorLabel: triggeredBy?.actorLabel ?? null,
      action: AuditAction.PASSWORD_RESET_SENT,
      resourceType:
        user.role === UserRole.VENDOR ? AuditResourceType.VENDOR : AuditResourceType.USER,
      resourceId: user.id,
      metadata: { email: user.email },
      ...getAuditRequestContext(req),
    });
  }

  async sendEmailVerificationOnRegistration(userId: string, req?: unknown): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user || user.emailVerified) {
      return;
    }

    await this.createAndSendEmailVerificationToken(user, undefined, req);
  }

  async resendEmailVerification(userId: string, req?: unknown): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId, isActive: true },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.emailVerified) {
      throw new BadRequestException({
        code: 'EMAIL_ALREADY_VERIFIED',
        message: 'Email is already verified',
      });
    }

    await this.createAndSendEmailVerificationToken(
      user,
      {
        actorType: AuditActorType.VENDOR,
        actorId: user.id,
        actorLabel: user.fullName || user.email,
      },
      req,
    );

    return {
      message: 'Email verification sent',
    };
  }

  async adminResendVendorEmailVerification(
    vendorId: string,
    admin?: { id: string; fullName?: string },
    req?: unknown,
  ): Promise<{ message: string }> {
    const vendor = await this.userRepository.findOne({
      where: { id: vendorId, role: UserRole.VENDOR, isActive: true },
    });

    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }

    if (vendor.emailVerified) {
      throw new BadRequestException({
        code: 'EMAIL_ALREADY_VERIFIED',
        message: 'Vendor email is already verified',
      });
    }

    await this.createAndSendEmailVerificationToken(
      vendor,
      {
        actorType: AuditActorType.ADMIN,
        actorId: admin?.id,
        actorLabel: admin?.fullName,
      },
      req,
    );

    return {
      message: 'Email verification sent to vendor',
    };
  }

  async adminVerifyVendorEmail(
    vendorId: string,
    admin?: { id: string; fullName?: string },
    req?: unknown,
  ): Promise<{ message: string }> {
    const vendor = await this.userRepository.findOne({
      where: { id: vendorId, role: UserRole.VENDOR, isActive: true },
    });

    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }

    if (vendor.emailVerified) {
      throw new BadRequestException({
        code: 'EMAIL_ALREADY_VERIFIED',
        message: 'Vendor email is already verified',
      });
    }

    vendor.emailVerified = true;
    await this.userRepository.save(vendor);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: admin?.id ?? null,
      actorLabel: admin?.fullName ?? null,
      action: AuditAction.EMAIL_VERIFIED,
      resourceType: AuditResourceType.VENDOR,
      resourceId: vendor.id,
      metadata: { email: vendor.email, method: 'admin_override' },
      ...getAuditRequestContext(req),
    });

    return {
      message: 'Vendor email verified',
    };
  }

  async verifyEmail(token: string, req?: unknown): Promise<{ message: string }> {
    const verificationToken = await this.emailVerificationTokenRepository.findOne({
      where: { token },
    });

    if (!verificationToken || verificationToken.usedAt) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired verification token',
      });
    }

    if (verificationToken.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'TOKEN_EXPIRED',
        message: 'Verification token has expired',
      });
    }

    const user = await this.userRepository.findOne({
      where: { email: verificationToken.email, isActive: true },
    });
    if (!user) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired verification token',
      });
    }

    if (!user.emailVerified) {
      user.emailVerified = true;
      await this.userRepository.save(user);

      await this.auditLogsService.log({
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        actorLabel: null,
        action: AuditAction.EMAIL_VERIFIED,
        resourceType:
          user.role === UserRole.VENDOR ? AuditResourceType.VENDOR : AuditResourceType.USER,
        resourceId: user.id,
        metadata: { email: user.email, method: 'token' },
        ...getAuditRequestContext(req),
      });
    }

    verificationToken.usedAt = new Date();
    await this.emailVerificationTokenRepository.save(verificationToken);

    return { message: 'Email verified successfully' };
  }

  private async createAndSendEmailVerificationToken(
    user: User,
    triggeredBy?: { actorType: AuditActorType; actorId?: string; actorLabel?: string },
    req?: unknown,
  ): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const verificationToken = this.emailVerificationTokenRepository.create({
      email: user.email,
      token,
      expiresAt,
    });
    await this.emailVerificationTokenRepository.save(verificationToken);
    await this.emailDeliveryService.sendEmailVerification(user.email, token);

    await this.auditLogsService.log({
      actorType: triggeredBy?.actorType ?? AuditActorType.SYSTEM,
      actorId: triggeredBy?.actorId ?? null,
      actorLabel: triggeredBy?.actorLabel ?? null,
      action: AuditAction.EMAIL_VERIFICATION_SENT,
      resourceType:
        user.role === UserRole.VENDOR ? AuditResourceType.VENDOR : AuditResourceType.USER,
      resourceId: user.id,
      metadata: { email: user.email },
      ...getAuditRequestContext(req),
    });
  }
}
