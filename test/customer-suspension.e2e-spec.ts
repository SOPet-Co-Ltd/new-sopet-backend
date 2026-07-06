import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { AuthService } from '../src/modules/auth/auth.service';
import { CartService } from '../src/modules/cart/cart.service';
import { Customer } from '../src/database/entities/customer.entity';
import { User } from '../src/database/entities/user.entity';
import { OtpCode } from '../src/database/entities/otp-code.entity';
import { Store } from '../src/database/entities/store.entity';
import { StoreMember } from '../src/database/entities/store-member.entity';
import { PasswordResetToken } from '../src/database/entities/password-reset-token.entity';
import { SmsService } from '../src/modules/sms/sms.service';
import { EmailDeliveryService } from '../src/modules/email/email-delivery.service';

describe('Customer suspension (e2e)', () => {
  let authService: AuthService;
  const cartService = { mergeGuestCart: jest.fn() };
  const otpRepo = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
  };
  const customerRepo = {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'cust-1' })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(OtpCode), useValue: otpRepo },
        { provide: getRepositoryToken(Store), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(StoreMember), useValue: { findOne: jest.fn() } },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: { findOne: jest.fn(), save: jest.fn(), delete: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn(async (p) => `tok-${p.type}`) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => '15m') },
        },
        { provide: SmsService, useValue: { sendOtp: jest.fn() } },
        { provide: CartService, useValue: cartService },
        { provide: EmailDeliveryService, useValue: { sendPasswordReset: jest.fn() } },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  it('verifyOtp returns CUSTOMER_SUSPENDED for inactive customer', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '123456',
      isUsed: false,
    });
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: null,
    } as Customer);

    await expect(
      authService.verifyOtp({ phone: '+66812345678', code: '123456' }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_SUSPENDED' },
    });
    expect(cartService.mergeGuestCart).not.toHaveBeenCalled();
  });

  it('verifyOtp succeeds for active customer', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '654321',
      isUsed: false,
    });
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: true,
    });

    const result = await authService.verifyOtp({
      phone: '+66812345678',
      code: '654321',
      sessionId: 'guest-session',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
    expect(cartService.mergeGuestCart).toHaveBeenCalledWith('cust-1', 'guest-session');
  });

  it('verifyOtp throws ForbiddenException for suspended customer', async () => {
    otpRepo.findOne.mockResolvedValue({
      phone: '+66812345678',
      code: '123456',
      isUsed: false,
    });
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      isActive: false,
      deletionRequestedAt: null,
    } as Customer);

    await expect(authService.verifyOtp({ phone: '+66812345678', code: '123456' })).rejects.toThrow(
      ForbiddenException,
    );
  });
});
