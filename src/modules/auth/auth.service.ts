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
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Customer } from '../../database/entities/customer.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { pickDefaultAccessibleStoreId } from '../stores/store-selection.util';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { SendOtpDto, VerifyOtpDto, LoginDto } from './dto';
import { JwtPayload } from '../../common/interfaces';
import { normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { SmsService } from '../sms/sms.service';
import { CartService } from '../cart/cart.service';
import { GuestOrderLinkService } from '../orders/guest-order-link.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { StorageService } from '../storage/storage.service';
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

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    private readonly customerRepo: CustomerRepository,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(OtpCode)
    private otpRepository: Repository<OtpCode>,
    @InjectRepository(Store)
    private storeRepository: Repository<Store>,
    @InjectRepository(StoreMember)
    private storeMemberRepository: Repository<StoreMember>,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private smsService: SmsService,
    private cartService: CartService,
    private guestOrderLinkService: GuestOrderLinkService,
    private emailDeliveryService: EmailDeliveryService,
    private readonly storageService: StorageService,
  ) {}

  // Generate random 6-digit OTP
  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Send OTP to customer phone
  async sendOtp(sendOtpDto: SendOtpDto): Promise<{ message: string }> {
    const phone = normalizeThaiPhoneToLocal(sendOtpDto.phone);

    // Check for rate limiting (max 3 attempts per 5 minutes)
    const recentAttempts = await this.otpRepository.count({
      where: {
        phone,
        createdAt: MoreThan(new Date(Date.now() - 5 * 60 * 1000)),
      },
    });

    if (recentAttempts >= 3) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many OTP requests. Please try again in 5 minutes.',
      });
    }

    // Generate OTP
    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to database
    const otp = this.otpRepository.create({
      phone,
      code,
      expiresAt,
    });
    await this.otpRepository.save(otp);

    await this.smsService.sendOtp(phone, code);

    return {
      message: 'OTP sent successfully',
    };
  }

  // Verify OTP and return JWT tokens
  async verifyOtp(verifyOtpDto: VerifyOtpDto & { sessionId?: string }): Promise<{
    accessToken?: string;
    refreshToken?: string;
    customer: Partial<Customer>;
    pendingDeletion?: boolean;
    reactivationToken?: string;
  }> {
    const { code, sessionId } = verifyOtpDto;
    const phone = normalizeThaiPhoneToLocal(verifyOtpDto.phone);

    // Find valid OTP
    const otp = await this.otpRepository.findOne({
      where: {
        phone,
        code,
        isUsed: false,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!otp) {
      throw new UnauthorizedException({
        code: 'INVALID_OTP',
        message: 'Invalid or expired OTP code',
      });
    }

    // Mark OTP as used
    otp.isUsed = true;
    await this.otpRepository.save(otp);

    // Find or create customer
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

    // Generate tokens
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

  // Vendor/Admin login with email + password
  async login(loginDto: LoginDto): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Partial<User>;
  }> {
    const { email, password } = loginDto;

    // Find user
    const user = await this.userRepository.findOne({
      where: { email, isActive: true },
      relations: ['ownedStores'],
    });

    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // Update last login
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    // Generate tokens
    const payload: Omit<JwtPayload, 'type'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    // Add storeId for vendors (owned store first, then team memberships)
    if (user.role === UserRole.VENDOR) {
      const storeId = await this.resolveDefaultStoreId(user.id);
      if (storeId) {
        payload.storeId = storeId;
      }
    }

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

  // Refresh access token
  async refreshToken(token: string): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Invalid token type');
      }

      const newPayload: Omit<JwtPayload, 'type'> = {
        sub: payload.sub,
        email: payload.email,
        phone: payload.phone,
        role: payload.role,
        storeId: payload.storeId,
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

      return this.generateTokens(newPayload);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
  }

  // Generate access and refresh tokens
  private async generateTokens(
    payload: Omit<JwtPayload, 'type'>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, type: 'access' },
        {
          expiresIn: this.configService.get<string>('jwt.accessTokenExpiresIn'),
        },
      ),
      this.jwtService.signAsync(
        { ...payload, type: 'refresh' },
        {
          expiresIn: this.configService.get<string>('jwt.refreshTokenExpiresIn'),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  // Hash password for user registration
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
      where: { id: userId, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
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

    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'status'],
    });
    if (store?.status === StoreStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'STORE_SUSPENDED',
        message: 'This store has been suspended. Please contact support to restore access.',
      });
    }

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
    await this.userRepository.save(user);
  }

  async requestPasswordReset(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.toLowerCase();
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail, isActive: true },
    });

    if (user) {
      await this.createAndSendPasswordResetToken(user);
    }

    return {
      message: 'If an account exists for this email, a password reset link has been sent',
    };
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
    await this.userRepository.save(user);

    resetToken.usedAt = new Date();
    await this.passwordResetTokenRepository.save(resetToken);

    return { message: 'Password reset successfully' };
  }

  async adminTriggerVendorPasswordReset(vendorId: string): Promise<{ message: string }> {
    const vendor = await this.userRepository.findOne({
      where: { id: vendorId, role: UserRole.VENDOR, isActive: true },
    });

    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }

    await this.createAndSendPasswordResetToken(vendor);

    return {
      message: 'Password reset email sent to vendor',
    };
  }

  private async createAndSendPasswordResetToken(user: User): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const resetToken = this.passwordResetTokenRepository.create({
      email: user.email,
      token,
      expiresAt,
    });
    await this.passwordResetTokenRepository.save(resetToken);
    await this.emailDeliveryService.sendPasswordReset(user.email, token);
  }
}
