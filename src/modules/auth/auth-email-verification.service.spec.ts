import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
import { AuditAction } from '../audit-logs/audit-log.constants';

describe('AuthService email verification', () => {
  let service: AuthService;
  let auditLogsService: { log: jest.Mock };

  const userRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const emailVerificationRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'token-row-1' })),
    findOne: jest.fn(),
  };
  const emailDeliveryService = {
    sendEmailVerification: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    auditLogsService = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Customer), useValue: {} },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(OtpCode), useValue: {} },
        { provide: getRepositoryToken(Store), useValue: {} },
        { provide: getRepositoryToken(StoreMember), useValue: {} },
        { provide: getRepositoryToken(PasswordResetToken), useValue: {} },
        {
          provide: getRepositoryToken(EmailVerificationToken),
          useValue: emailVerificationRepo,
        },
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
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('adminResendVendorEmailVerification creates token and sends email', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: false,
    });

    const result = await service.adminResendVendorEmailVerification('vendor-1', {
      id: 'admin-1',
      fullName: 'admin@test.com',
    });

    expect(result.message).toContain('sent');
    expect(emailVerificationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'vendor@test.com',
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    );
    expect(emailDeliveryService.sendEmailVerification).toHaveBeenCalledWith(
      'vendor@test.com',
      expect.any(String),
    );
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.EMAIL_VERIFICATION_SENT }),
    );
  });

  it('adminResendVendorEmailVerification rejects already verified vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: true,
    });

    await expect(service.adminResendVendorEmailVerification('vendor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('adminResendVendorEmailVerification rejects missing vendor', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(service.adminResendVendorEmailVerification('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('adminVerifyVendorEmail marks vendor as verified', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: false,
    });

    const result = await service.adminVerifyVendorEmail('vendor-1', {
      id: 'admin-1',
      fullName: 'admin@test.com',
    });

    expect(result.message).toContain('verified');
    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: true }));
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EMAIL_VERIFIED,
        metadata: expect.objectContaining({ method: 'admin_override' }),
      }),
    );
  });

  it('verifyEmail verifies user for valid token', async () => {
    const verificationToken = {
      token: 'valid-token',
      email: 'vendor@test.com',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    emailVerificationRepo.findOne.mockResolvedValue(verificationToken);
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: false,
    });

    const result = await service.verifyEmail('valid-token');

    expect(result.message).toBe('Email verified successfully');
    expect(userRepo.save).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: true }));
    expect(emailVerificationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ usedAt: expect.any(Date) }),
    );
  });

  it('verifyEmail rejects invalid token', async () => {
    emailVerificationRepo.findOne.mockResolvedValue(null);

    await expect(service.verifyEmail('bad-token')).rejects.toThrow(BadRequestException);
  });

  it('resendEmailVerification sends email for unverified vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      fullName: 'Vendor',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: false,
    });

    const result = await service.resendEmailVerification('vendor-1');

    expect(result.message).toContain('sent');
    expect(emailDeliveryService.sendEmailVerification).toHaveBeenCalledWith(
      'vendor@test.com',
      expect.any(String),
    );
  });

  it('resendEmailVerification rejects already verified user', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: true,
    });

    await expect(service.resendEmailVerification('vendor-1')).rejects.toThrow(BadRequestException);
  });

  it('sendEmailVerificationOnRegistration sends email for new vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: false,
    });

    await service.sendEmailVerificationOnRegistration('vendor-1');

    expect(emailDeliveryService.sendEmailVerification).toHaveBeenCalled();
  });

  it('sendEmailVerificationOnRegistration skips verified vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      role: UserRole.VENDOR,
      isActive: true,
      emailVerified: true,
    });

    await service.sendEmailVerificationOnRegistration('vendor-1');

    expect(emailDeliveryService.sendEmailVerification).not.toHaveBeenCalled();
  });
});
