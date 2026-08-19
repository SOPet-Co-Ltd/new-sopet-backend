import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Customer } from '../../database/entities/customer.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { EmailVerificationToken } from '../../database/entities/email-verification-token.entity';
import { SmsService } from '../sms/sms.service';
import { CartService } from '../cart/cart.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { GuestOrderLinkService } from '../orders/guest-order-link.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RedisService } from '../redis/redis.service';

describe('AuthService password reset', () => {
  let service: AuthService;

  const userRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const invalidatePriorTokensExecute = jest.fn().mockResolvedValue({ affected: 0 });
  const invalidatePriorTokensQueryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: invalidatePriorTokensExecute,
  };
  const passwordResetRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'token-row-1' })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => invalidatePriorTokensQueryBuilder),
  };
  const emailDeliveryService = {
    sendPasswordReset: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Re-bind chain after clearAllMocks so returnThis still works.
    invalidatePriorTokensQueryBuilder.update.mockReturnThis();
    invalidatePriorTokensQueryBuilder.set.mockReturnThis();
    invalidatePriorTokensQueryBuilder.where.mockReturnThis();
    invalidatePriorTokensQueryBuilder.andWhere.mockReturnThis();
    invalidatePriorTokensExecute.mockResolvedValue({ affected: 0 });
    passwordResetRepo.createQueryBuilder.mockReturnValue(invalidatePriorTokensQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Customer), useValue: {} },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(OtpCode), useValue: {} },
        { provide: getRepositoryToken(Store), useValue: {} },
        { provide: getRepositoryToken(StoreMember), useValue: {} },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: passwordResetRepo,
        },
        { provide: getRepositoryToken(EmailVerificationToken), useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SmsService, useValue: {} },
        { provide: CartService, useValue: {} },
        { provide: GuestOrderLinkService, useValue: {} },
        { provide: CustomerRepository, useValue: {} },
        { provide: EmailDeliveryService, useValue: emailDeliveryService },
        {
          provide: StorageService,
          useValue: {
            assertFolderImageUrl: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: RedisService,
          useValue: {
            isAvailable: jest.fn().mockReturnValue(false),
            get: jest.fn(),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('requestPasswordReset creates token and sends email when user exists', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      isActive: true,
    });

    const result = await service.requestPasswordReset('vendor@test.com');

    expect(result.message).toContain('password reset link');
    expect(passwordResetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'vendor@test.com',
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    );
    expect(passwordResetRepo.save).toHaveBeenCalled();
    expect(emailDeliveryService.sendPasswordReset).toHaveBeenCalledWith(
      'vendor@test.com',
      expect.any(String),
    );
  });

  it('requestPasswordReset invalidates prior unused tokens for the same email (row 34)', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      isActive: true,
    });

    await service.requestPasswordReset('vendor@test.com');

    expect(passwordResetRepo.createQueryBuilder).toHaveBeenCalled();
    expect(invalidatePriorTokensQueryBuilder.update).toHaveBeenCalledWith(PasswordResetToken);
    expect(invalidatePriorTokensQueryBuilder.set).toHaveBeenCalledWith({
      usedAt: expect.any(Date),
    });
    expect(invalidatePriorTokensQueryBuilder.where).toHaveBeenCalledWith('email = :email', {
      email: 'vendor@test.com',
    });
    expect(invalidatePriorTokensQueryBuilder.andWhere).toHaveBeenCalledWith('used_at IS NULL');
    expect(invalidatePriorTokensExecute).toHaveBeenCalled();
    // Newest token is still created after invalidation.
    expect(passwordResetRepo.create).toHaveBeenCalled();
    expect(emailDeliveryService.sendPasswordReset).toHaveBeenCalled();
  });

  it('requestPasswordReset returns generic message when user missing', async () => {
    userRepo.findOne.mockResolvedValue(null);

    const result = await service.requestPasswordReset('missing@test.com');

    expect(result.message).toContain('password reset link');
    expect(passwordResetRepo.save).not.toHaveBeenCalled();
    expect(emailDeliveryService.sendPasswordReset).not.toHaveBeenCalled();
    expect(passwordResetRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('resetPassword updates password for valid token', async () => {
    const hash = await bcrypt.hash('old-password', 10);
    const resetToken = {
      token: 'valid-token',
      email: 'vendor@test.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    passwordResetRepo.findOne.mockResolvedValue(resetToken);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      isActive: true,
      passwordHash: hash,
    });

    const result = await service.resetPassword('valid-token', 'new-password-1');

    expect(result.message).toBe('Password reset successfully');
    expect(userRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: expect.not.stringContaining(hash),
      }),
    );
    expect(passwordResetRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
    // Also invalidates any other unused tokens for the email.
    expect(passwordResetRepo.createQueryBuilder).toHaveBeenCalled();
    expect(invalidatePriorTokensExecute).toHaveBeenCalled();
  });

  it('resetPassword rejects invalid token', async () => {
    passwordResetRepo.findOne.mockResolvedValue(null);

    await expect(service.resetPassword('bad-token', 'new-password-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resetPassword rejects used token (prior link after re-request)', async () => {
    passwordResetRepo.findOne.mockResolvedValue({
      token: 'old-token',
      email: 'vendor@test.com',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(service.resetPassword('old-token', 'new-password-1')).rejects.toMatchObject({
      response: { code: 'INVALID_TOKEN' },
    });
  });

  it('resetPassword rejects expired token', async () => {
    passwordResetRepo.findOne.mockResolvedValue({
      token: 'expired-token',
      email: 'vendor@test.com',
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.resetPassword('expired-token', 'new-password-1')).rejects.toMatchObject({
      response: { code: 'TOKEN_EXPIRED' },
    });
  });

  describe('getPasswordResetTokenStatus (row 33 regression)', () => {
    it('returns valid for a fresh, unused token', async () => {
      passwordResetRepo.findOne.mockResolvedValue({
        token: 'valid-token',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const result = await service.getPasswordResetTokenStatus('valid-token');

      expect(result).toEqual({ valid: true, status: 'valid' });
    });

    it('returns expired for a token past expiresAt', async () => {
      passwordResetRepo.findOne.mockResolvedValue({
        token: 'expired-token',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      const result = await service.getPasswordResetTokenStatus('expired-token');

      expect(result).toEqual({ valid: false, status: 'expired' });
    });

    it('returns used for an already-consumed token', async () => {
      passwordResetRepo.findOne.mockResolvedValue({
        token: 'used-token',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const result = await service.getPasswordResetTokenStatus('used-token');

      expect(result).toEqual({ valid: false, status: 'used' });
    });

    it('returns invalid for a token that does not exist', async () => {
      passwordResetRepo.findOne.mockResolvedValue(null);

      const result = await service.getPasswordResetTokenStatus('nonexistent-token');

      expect(result).toEqual({ valid: false, status: 'invalid' });
    });

    it('never mutates the token row (side-effect-free preview)', async () => {
      passwordResetRepo.findOne.mockResolvedValue({
        token: 'valid-token',
        usedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await service.getPasswordResetTokenStatus('valid-token');

      expect(passwordResetRepo.save).not.toHaveBeenCalled();
    });
  });

  it('adminTriggerVendorPasswordReset sends email for vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
    });

    const result = await service.adminTriggerVendorPasswordReset('vendor-1');

    expect(result.message).toContain('sent');
    expect(emailDeliveryService.sendPasswordReset).toHaveBeenCalled();
  });

  it('adminTriggerVendorPasswordReset rejects missing vendor', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(service.adminTriggerVendorPasswordReset('missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
