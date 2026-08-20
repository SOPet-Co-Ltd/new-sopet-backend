import { createHmac } from 'node:crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Customer } from '../../database/entities/customer.entity';
import { User } from '../../database/entities/user.entity';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { Store } from '../../database/entities/store.entity';
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
import { RedisService } from '../redis/redis.service';
import { AuthService } from './auth.service';

export const AUTH_SERVICE_TEST_JWT_SECRET = 'test-jwt-secret';

export function hashOtpForTest(code: string, secret = AUTH_SERVICE_TEST_JWT_SECRET): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

export interface AuthServiceTestMocks {
  customerRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  customerRepoWrapper: {
    findActiveByPhone: jest.Mock;
  };
  otpRepo: {
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  cartService: {
    mergeGuestCart: jest.Mock;
  };
  guestOrderLinkService: {
    mergeGuestOrders: jest.Mock;
  };
}

export function createAuthServiceTestMocks(): AuthServiceTestMocks {
  return {
    customerRepo: {
      findOne: jest.fn(),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: x.id ?? 'cust-1' })),
      update: jest.fn(),
      softDelete: jest.fn(),
    },
    customerRepoWrapper: {
      findActiveByPhone: jest.fn(),
    },
    otpRepo: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    },
    cartService: {
      mergeGuestCart: jest.fn(),
    },
    guestOrderLinkService: {
      mergeGuestOrders: jest.fn(),
    },
  };
}

export function createAuthServiceTestProviders(mocks: AuthServiceTestMocks) {
  return [
    AuthService,
    { provide: getRepositoryToken(Customer), useValue: mocks.customerRepo },
    { provide: CustomerRepository, useValue: mocks.customerRepoWrapper },
    { provide: getRepositoryToken(User), useValue: { findOne: jest.fn(), save: jest.fn() } },
    { provide: getRepositoryToken(OtpCode), useValue: mocks.otpRepo },
    { provide: getRepositoryToken(Store), useValue: { findOne: jest.fn() } },
    { provide: getRepositoryToken(StoreMember), useValue: { findOne: jest.fn() } },
    {
      provide: getRepositoryToken(PasswordResetToken),
      useValue: { findOne: jest.fn(), save: jest.fn(), delete: jest.fn() },
    },
    {
      provide: getRepositoryToken(EmailVerificationToken),
      useValue: { findOne: jest.fn(), save: jest.fn(), create: jest.fn() },
    },
    {
      provide: JwtService,
      useValue: { signAsync: jest.fn(async (p) => `tok-${p.type}`), verify: jest.fn() },
    },
    {
      provide: ConfigService,
      useValue: {
        get: jest.fn((key?: string) => {
          if (key === 'jwt.secret') return AUTH_SERVICE_TEST_JWT_SECRET;
          return '15m';
        }),
      },
    },
    { provide: SmsService, useValue: { sendOtp: jest.fn() } },
    { provide: CartService, useValue: mocks.cartService },
    { provide: GuestOrderLinkService, useValue: mocks.guestOrderLinkService },
    { provide: EmailDeliveryService, useValue: { sendPasswordReset: jest.fn() } },
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
        isConfigured: jest.fn().mockReturnValue(false),
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
      },
    },
  ];
}
