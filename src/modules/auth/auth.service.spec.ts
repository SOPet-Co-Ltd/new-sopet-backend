import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { Customer } from '../../database/entities/customer.entity';
import { User } from '../../database/entities/user.entity';
import { OtpCode, OtpPurpose } from '../../database/entities/otp-code.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { StoreMember } from '../../database/entities/store-member.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { EmailVerificationToken } from '../../database/entities/email-verification-token.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { SmsService } from '../sms/sms.service';
import { CartService } from '../cart/cart.service';
import { GuestOrderLinkService } from '../orders/guest-order-link.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const TEST_JWT_SECRET = 'test-jwt-secret';

function hashOtpForTest(code: string): string {
  return createHmac('sha256', TEST_JWT_SECRET).update(code).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  const customerRepo = {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'cust-1' })),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const userRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const otpRepo = {
    count: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  const jwtService = {
    signAsync: jest.fn(async (payload) => `token-${payload.type}`),
    verify: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'jwt.secret') return TEST_JWT_SECRET;
      if (key.includes('refresh')) return '7d';
      return '15m';
    }),
  };
  const smsService = { sendOtp: jest.fn() };
  const cartService = { mergeGuestCart: jest.fn() };
  const guestOrderLinkService = { mergeGuestOrders: jest.fn() };
  const customerRepoWrapper = { findActiveByPhone: jest.fn() };
  const storeRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 'store-1' }),
    find: jest.fn().mockResolvedValue([]),
  };
  const storeMemberRepo = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: CustomerRepository, useValue: customerRepoWrapper },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(OtpCode), useValue: otpRepo },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: getRepositoryToken(StoreMember), useValue: storeMemberRepo },
        { provide: getRepositoryToken(PasswordResetToken), useValue: {} },
        { provide: getRepositoryToken(EmailVerificationToken), useValue: {} },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: SmsService, useValue: smsService },
        { provide: CartService, useValue: cartService },
        { provide: GuestOrderLinkService, useValue: guestOrderLinkService },
        { provide: EmailDeliveryService, useValue: { sendPasswordReset: jest.fn() } },
        {
          provide: StorageService,
          useValue: {
            assertFolderImageUrl: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('rate limits sendOtp after 3 attempts', async () => {
    otpRepo.count.mockResolvedValue(3);

    await expect(service.sendOtp({ phone: '+66812345678' })).rejects.toThrow(BadRequestException);
    expect(smsService.sendOtp).not.toHaveBeenCalled();
  });

  it('sends OTP when under rate limit', async () => {
    otpRepo.count.mockResolvedValue(0);

    const result = await service.sendOtp({ phone: '+66812345678' });

    expect(result.message).toBe('OTP sent successfully');
    expect(otpRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '0812345678',
        code: expect.stringMatching(/^[a-f0-9]{64}$/),
        purpose: OtpPurpose.LOGIN,
      }),
    );
    expect(otpRepo.update).toHaveBeenCalledWith(
      { phone: '0812345678', isUsed: false },
      { isUsed: true },
    );
    expect(otpRepo.save).toHaveBeenCalled();
    expect(smsService.sendOtp).toHaveBeenCalledWith('0812345678', expect.stringMatching(/^\d{6}$/));
    const savedCode = otpRepo.create.mock.calls[0][0].code as string;
    const smsCode = smsService.sendOtp.mock.calls[0][1] as string;
    expect(savedCode).toBe(hashOtpForTest(smsCode));
    expect(savedCode).not.toBe(smsCode);
  });

  it('invalidates previous unused OTPs before issuing a new one', async () => {
    otpRepo.count.mockResolvedValue(1);

    await service.sendOtp({ phone: '+66812345678' });

    expect(otpRepo.update).toHaveBeenCalledWith(
      { phone: '0812345678', isUsed: false },
      { isUsed: true },
    );
    expect(otpRepo.update.mock.invocationCallOrder[0]).toBeLessThan(
      otpRepo.save.mock.invocationCallOrder[0],
    );
  });

  it('sets OTP expiry to 5 minutes', async () => {
    otpRepo.count.mockResolvedValue(0);
    const before = Date.now();

    await service.sendOtp({ phone: '+66812345678' });

    const created = otpRepo.create.mock.calls[0][0] as { expiresAt: Date };
    const ttlMs = created.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 50);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 50);
  });

  it('verifies OTP and returns tokens', async () => {
    const otp = {
      phone: '0812345678',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };
    otpRepo.findOne.mockResolvedValue(otp);
    customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      fullName: 'Test',
      email: null,
      isActive: true,
    });

    const result = await service.verifyOtp({
      phone: '+66812345678',
      code: '123456',
      sessionId: 'session-1',
    });

    expect(result.accessToken).toBe('token-access');
    expect(result.refreshToken).toBe('token-refresh');
    expect(cartService.mergeGuestCart).toHaveBeenCalledWith('cust-1', 'session-1');
    expect(guestOrderLinkService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0812345678');
  });

  it('rejects invalid OTP', async () => {
    otpRepo.findOne.mockResolvedValue(null);

    await expect(service.verifyOtp({ phone: '+66812345678', code: '000000' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an expired OTP', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0812345678',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(service.verifyOtp({ phone: '+66812345678', code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(customerRepoWrapper.findActiveByPhone).not.toHaveBeenCalled();
  });

  it('rejects a previous OTP when a newer unused OTP exists', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0812345678',
      code: hashOtpForTest('654321'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await expect(service.verifyOtp({ phone: '+66812345678', code: '123456' })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(customerRepoWrapper.findActiveByPhone).not.toHaveBeenCalled();
  });

  it('rejects OTP verify for suspended customer', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0812345678',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: null,
    });

    await expect(
      service.verifyOtp({ phone: '+66812345678', code: '123456' }),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_SUSPENDED' } });
    expect(cartService.mergeGuestCart).not.toHaveBeenCalled();
  });

  it('returns pending deletion flow for inactive customer within retention', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0812345678',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      fullName: 'Test',
      email: null,
      isActive: false,
      deletionRequestedAt: new Date(),
    });

    const result = await service.verifyOtp({ phone: '+66812345678', code: '123456' });

    expect(result.pendingDeletion).toBe(true);
    expect(result.reactivationToken).toBeDefined();
    expect(result.accessToken).toBeUndefined();
    expect(cartService.mergeGuestCart).not.toHaveBeenCalled();
  });

  it('finalizes expired deletion and creates new customer on OTP verify', async () => {
    const oldRequestedAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
    otpRepo.findOne.mockResolvedValue({
      phone: '0812345678',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    customerRepoWrapper.findActiveByPhone.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: oldRequestedAt,
    });
    customerRepo.create.mockImplementation((x) => x);

    const result = await service.verifyOtp({ phone: '+66812345678', code: '123456' });

    expect(customerRepo.update).toHaveBeenCalledWith('cust-1', {
      fullName: null,
      email: null,
    });
    expect(customerRepo.softDelete).toHaveBeenCalledWith('cust-1');
    expect(result.accessToken).toBe('token-access');
    expect(customerRepo.save).toHaveBeenCalled();
  });

  it('rejects login with invalid credentials', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(
      service.login({ email: 'vendor@test.com', password: 'wrong' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
  });

  it('rejects login with wrong password', async () => {
    const hash = await bcrypt.hash('correct', 10);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      passwordHash: hash,
      role: 'vendor',
      isActive: true,
      ownedStores: [],
    });

    await expect(
      service.login({ email: 'vendor@test.com', password: 'wrong' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
  });

  it('rejects login for suspended vendor after valid password with ACCOUNT_SUSPENDED', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      passwordHash: hash,
      role: 'vendor',
      isActive: false,
      ownedStores: [],
    });

    await expect(
      service.login({ email: 'vendor@test.com', password: 'secret123' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.login({ email: 'vendor@test.com', password: 'secret123' }),
    ).rejects.toMatchObject({
      response: {
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended. Please contact support for assistance.',
      },
    });
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('keeps INVALID_CREDENTIALS when suspended vendor uses wrong password', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      passwordHash: hash,
      role: 'vendor',
      isActive: false,
      ownedStores: [],
    });

    await expect(
      service.login({ email: 'vendor@test.com', password: 'wrong' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
  });

  it('logs in vendor with valid credentials', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      passwordHash: hash,
      role: 'vendor',
      isActive: true,
      fullName: 'Vendor',
      ownedStores: [{ id: 'store-1' }],
    });
    storeRepo.find.mockResolvedValue([
      { id: 'store-1', status: StoreStatus.APPROVED, createdAt: new Date('2026-07-01') },
    ]);
    storeMemberRepo.find.mockResolvedValue([]);

    const result = await service.login({
      email: 'vendor@test.com',
      password: 'secret123',
    });

    expect(result.accessToken).toBe('token-access');
    expect(result.user.email).toBe('vendor@test.com');
    expect(userRepo.save).toHaveBeenCalled();
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-1' }),
      expect.anything(),
    );
  });

  it('defaults vendor login to an approved store when a newer store is suspended', async () => {
    const hash = await bcrypt.hash('secret123', 10);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'vendor@test.com',
      passwordHash: hash,
      role: 'vendor',
      isActive: true,
      fullName: 'Vendor',
      ownedStores: [],
    });
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-suspended',
        status: StoreStatus.SUSPENDED,
        createdAt: new Date('2026-07-02T20:00:00Z'),
      },
      {
        id: 'store-approved',
        status: StoreStatus.APPROVED,
        createdAt: new Date('2026-07-02T15:00:00Z'),
      },
    ]);
    storeMemberRepo.find.mockResolvedValue([]);

    await service.login({
      email: 'vendor@test.com',
      password: 'secret123',
    });

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ storeId: 'store-approved' }),
      expect.anything(),
    );
  });

  it('creates customer on first OTP verify with local-format phone', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0811112222',
      code: hashOtpForTest('111111'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    customerRepoWrapper.findActiveByPhone.mockResolvedValue(null);

    const result = await service.verifyOtp({ phone: '0811112222', code: '111111' });

    expect(customerRepo.save).toHaveBeenCalled();
    expect(result.customer.phone).toBe('0811112222');
  });

  it('normalizes +66 phone to local format on OTP verify', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '0811112222',
      code: hashOtpForTest('111111'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    customerRepoWrapper.findActiveByPhone.mockResolvedValue(null);

    const result = await service.verifyOtp({ phone: '+66811112222', code: '111111' });

    expect(otpRepo.findOne).toHaveBeenCalledWith({
      where: {
        phone: '0811112222',
        isUsed: false,
        expiresAt: expect.anything(),
      },
      order: { createdAt: 'DESC' },
    });
    expect(result.customer.phone).toBe('0811112222');
  });

  it('refreshes tokens with valid refresh token', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'cust-1',
      phone: '+66812345678',
      role: 'customer',
      type: 'refresh',
    });
    customerRepo.findOne.mockResolvedValue({ id: 'cust-1', isActive: true });

    const result = await service.refreshToken('valid-refresh');

    expect(result.accessToken).toBe('token-access');
    expect(result.refreshToken).toBe('token-refresh');
  });

  it('rejects invalid refresh token', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid');
    });

    await expect(service.refreshToken('bad')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects refresh token for suspended customer', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'cust-1',
      phone: '+66812345678',
      role: 'customer',
      type: 'refresh',
    });
    customerRepo.findOne.mockResolvedValue({ id: 'cust-1', isActive: false });

    await expect(service.refreshToken('valid-refresh')).rejects.toMatchObject({
      response: { code: 'CUSTOMER_SUSPENDED' },
    });
  });

  it('rejects refresh token for suspended vendor', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'vendor-1',
      email: 'vendor@test.com',
      role: 'vendor',
      type: 'refresh',
      storeId: 'store-1',
    });
    userRepo.findOne.mockResolvedValue({ id: 'vendor-1', isActive: false });

    await expect(service.refreshToken('valid-refresh')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_SUSPENDED' },
    });
  });

  it('refreshes tokens for active vendor', async () => {
    jwtService.verify.mockReturnValue({
      sub: 'vendor-1',
      email: 'vendor@test.com',
      role: 'vendor',
      type: 'refresh',
      storeId: 'store-1',
    });
    userRepo.findOne.mockResolvedValue({ id: 'vendor-1', isActive: true });

    const result = await service.refreshToken('valid-refresh');

    expect(result.accessToken).toBe('token-access');
    expect(result.refreshToken).toBe('token-refresh');
  });

  it('returns customer profile from getMe', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: true,
    });

    const result = await service.getMe('cust-1', 'customer');

    expect(result.customer?.id).toBe('cust-1');
  });

  it('rejects getMe for suspended customer', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
    });

    await expect(service.getMe('cust-1', 'customer')).rejects.toMatchObject({
      response: { code: 'CUSTOMER_SUSPENDED' },
    });
  });

  it('rejects getMe for suspended vendor', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'vendor-1',
      email: 'vendor@test.com',
      isActive: false,
    });

    await expect(service.getMe('vendor-1', 'vendor')).rejects.toMatchObject({
      response: { code: 'ACCOUNT_SUSPENDED' },
    });
  });

  it('hashes password', async () => {
    const hash = await service.hashPassword('password');
    expect(hash).toBeDefined();
    expect(await bcrypt.compare('password', hash)).toBe(true);
  });

  it('allows switching into a suspended store for read-only access', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      role: 'vendor',
      email: 'vendor@test.com',
      fullName: 'Vendor',
    });
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.SUSPENDED,
    });

    const result = await service.switchStore('user-1', 'store-1');

    expect(result.accessToken).toBe('token-access');
  });

  it('switches into an active store', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      role: 'vendor',
      email: 'vendor@test.com',
      fullName: 'Vendor',
    });
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    const result = await service.switchStore('user-1', 'store-1');

    expect(result.accessToken).toBe('token-access');
  });
});
