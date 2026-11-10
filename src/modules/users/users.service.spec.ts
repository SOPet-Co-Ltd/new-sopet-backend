import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { OtpCode } from '../../database/entities/otp-code.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { OrdersService } from '../orders/orders.service';
import { StorageService } from '../storage/storage.service';
import { createHmac } from 'node:crypto';

const TEST_OTP_HMAC_SECRET = 'test-otp-hmac-secret';

function hashOtpForTest(code: string): string {
  return createHmac('sha256', TEST_OTP_HMAC_SECRET).update(code).digest('hex');
}

describe('UsersService', () => {
  let service: UsersService;
  const customerRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
    update: jest.fn(),
    softDelete: jest.fn(),
  };
  const customerRepository = {
    finalizeDeletion: jest.fn(),
    findOtherActiveByPhone: jest.fn(),
  };
  let otpBypassCode: string | undefined;
  const jwtService = {
    verify: jest.fn(),
    signAsync: jest.fn(async (payload) => `token-${payload.type ?? 'reactivation'}`),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'otp.hmacSecret') return TEST_OTP_HMAC_SECRET;
      if (key === 'otp.bypassCode') return otpBypassCode;
      return key.includes('refresh') ? '7d' : '15m';
    }),
  };
  const otpRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const ordersService = {
    mergeGuestOrders: jest.fn(),
  };
  const paymentMethodQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    withDeleted: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const paymentMethodRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ id: 'pm-new', ...value })),
    update: jest.fn(),
    softDelete: jest.fn(),
    restore: jest.fn(),
    createQueryBuilder: jest.fn(() => paymentMethodQueryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    otpBypassCode = undefined;
    paymentMethodQueryBuilder.getOne.mockResolvedValue(null);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(SavedAddress), useValue: {} },
        { provide: getRepositoryToken(SavedPaymentMethod), useValue: paymentMethodRepo },
        { provide: getRepositoryToken(OtpCode), useValue: otpRepo },
        { provide: CustomerRepository, useValue: customerRepository },
        { provide: OrdersService, useValue: ordersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        {
          provide: StorageService,
          useValue: {
            assertFolderImageUrl: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('requests account deletion', async () => {
    const customer = {
      id: 'cust-1',
      isActive: true,
      deletionRequestedAt: null,
    } as Customer;
    customerRepo.findOne.mockResolvedValue(customer);

    await service.requestAccountDeletion('cust-1');

    expect(customer.isActive).toBe(false);
    expect(customer.deletionRequestedAt).toBeInstanceOf(Date);
    expect(customerRepo.save).toHaveBeenCalledWith(customer);
  });

  it('rejects deletion request for unknown customer', async () => {
    customerRepo.findOne.mockResolvedValue(null);

    await expect(service.requestAccountDeletion('missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate deletion request', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      deletionRequestedAt: new Date(),
    });

    await expect(service.requestAccountDeletion('cust-1')).rejects.toThrow(BadRequestException);
  });

  it('reactivates account with valid token', async () => {
    jwtService.verify.mockReturnValue({ sub: 'cust-1', purpose: 'reactivation' });
    const requestedAt = new Date();
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '+66812345678',
      fullName: 'Test',
      email: null,
      isActive: false,
      deletionRequestedAt: requestedAt,
    });

    const result = await service.reactivateAccount('valid-token');

    expect(result.accessToken).toBe('token-access');
    expect(result.refreshToken).toBe('token-refresh');
    expect(customerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        deletionRequestedAt: null,
      }),
    );
  });

  it('rejects invalid reactivation token', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid');
    });

    await expect(service.reactivateAccount('bad-token')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects reactivation for non-pending account', async () => {
    jwtService.verify.mockReturnValue({ sub: 'cust-1', purpose: 'reactivation' });
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      isActive: true,
      deletionRequestedAt: null,
    });

    await expect(service.reactivateAccount('valid-token')).rejects.toThrow(BadRequestException);
  });

  it('changes customer phone and links guest orders', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '0811111111',
    });
    customerRepository.findOtherActiveByPhone.mockResolvedValue(null);
    otpRepo.findOne.mockResolvedValue({
      phone: '0822222222',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const result = await service.changeCustomerPhone('cust-1', '0822222222', '123456');

    expect(result.customer.phone).toBe('0822222222');
    expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0811111111');
    expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0822222222');
    expect(result.accessToken).toBe('token-access');
  });

  it('accepts OTP_BYPASS_CODE for phone change after send', async () => {
    otpBypassCode = '000000';
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '0811111111',
    });
    customerRepository.findOtherActiveByPhone.mockResolvedValue(null);
    otpRepo.findOne.mockResolvedValue({
      phone: '0822222222',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    const result = await service.changeCustomerPhone('cust-1', '0822222222', '000000');

    expect(result.customer.phone).toBe('0822222222');
    expect(otpRepo.save).toHaveBeenCalledWith(expect.objectContaining({ isUsed: true }));
  });

  it('rejects phone change bypass when no unused OTP was sent', async () => {
    otpBypassCode = '000000';
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '0811111111',
    });
    customerRepository.findOtherActiveByPhone.mockResolvedValue(null);
    otpRepo.findOne.mockResolvedValue(null);

    await expect(service.changeCustomerPhone('cust-1', '0822222222', '000000')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong OTP on phone change when bypass is unset', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '0811111111',
    });
    customerRepository.findOtherActiveByPhone.mockResolvedValue(null);
    otpRepo.findOne.mockResolvedValue({
      phone: '0822222222',
      code: hashOtpForTest('123456'),
      isUsed: false,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await expect(service.changeCustomerPhone('cust-1', '0822222222', '000000')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects phone change when number is already in use', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'cust-1',
      phone: '0811111111',
    });
    customerRepository.findOtherActiveByPhone.mockResolvedValue({
      id: 'cust-2',
      phone: '0822222222',
    });

    await expect(service.changeCustomerPhone('cust-1', '0822222222', '123456')).rejects.toThrow(
      ConflictException,
    );
  });

  describe('payment methods', () => {
    it('lists only active Beam cards', async () => {
      paymentMethodRepo.find.mockResolvedValue([]);

      await service.getPaymentMethods('cust-1');

      expect(paymentMethodRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ customerId: 'cust-1', psp: 'beam' }),
        }),
      );
    });

    it('stores the Beam token without calling an Omise vault and marks the first card default', async () => {
      paymentMethodRepo.find.mockResolvedValue([]);

      const result = await service.addPaymentMethod('cust-1', {
        cardToken: 'beam_tok_1',
        lastFour: '4242',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
        isDefault: false,
      });

      expect(result.isDefault).toBe(true);
      expect(paymentMethodRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          psp: 'beam',
          pspCardToken: 'beam_tok_1',
          omiseCardToken: null,
          lastFour: '4242',
          brand: 'visa',
          expiryMonth: 12,
          expiryYear: 2034,
          isDefault: true,
        }),
      );
    });

    it('soft-deletes legacy Omise cards when adding a Beam card', async () => {
      paymentMethodRepo.find.mockResolvedValue([]);

      await service.addPaymentMethod('cust-1', {
        cardToken: 'beam_tok_1',
        lastFour: '4242',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });

      expect(paymentMethodRepo.softDelete).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: 'cust-1', psp: 'omise' }),
      );
      expect(paymentMethodRepo.softDelete).toHaveBeenCalledTimes(2);
    });

    it('restores a soft-deleted Beam card instead of inserting a duplicate row', async () => {
      paymentMethodRepo.find.mockResolvedValue([]);
      paymentMethodQueryBuilder.getOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'pm-deleted',
        customerId: 'cust-1',
        deletedAt: new Date('2026-01-01'),
        isDefault: false,
      });

      const result = await service.addPaymentMethod('cust-1', {
        cardToken: 'beam_tok_new',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });

      expect(paymentMethodRepo.restore).toHaveBeenCalledWith('pm-deleted');
      expect(result.pspCardToken).toBe('beam_tok_new');
      expect(result.psp).toBe('beam');
      expect(result.isDefault).toBe(true);
    });

    it('throws ConflictException when the payment method already exists', async () => {
      paymentMethodRepo.find.mockResolvedValue([
        { id: 'pm-existing', customerId: 'cust-1', isDefault: true },
      ]);
      paymentMethodQueryBuilder.getOne.mockResolvedValue({
        id: 'pm-existing',
        customerId: 'cust-1',
        isDefault: true,
      });

      await expect(
        service.addPaymentMethod('cust-1', {
          cardToken: 'beam_tok_1',
          lastFour: '1111',
          brand: 'visa',
          expiryMonth: 12,
          expiryYear: 2034,
        }),
      ).rejects.toThrow(ConflictException);

      expect(paymentMethodRepo.create).not.toHaveBeenCalled();
      expect(paymentMethodRepo.softDelete).not.toHaveBeenCalled();
    });

    it('promotes another card when the default card is deleted', async () => {
      paymentMethodRepo.findOne.mockResolvedValue({
        id: 'pm-default',
        customerId: 'cust-1',
        isDefault: true,
        psp: 'beam',
        pspCardToken: 'beam_tok_default',
      });
      paymentMethodRepo.find.mockResolvedValue([
        {
          id: 'pm-other',
          customerId: 'cust-1',
          isDefault: false,
          createdAt: new Date('2026-01-01'),
        },
      ]);

      await service.deletePaymentMethod('cust-1', 'pm-default');

      expect(paymentMethodRepo.softDelete).toHaveBeenCalledWith('pm-default');
      expect(paymentMethodRepo.update).toHaveBeenCalledWith(
        { customerId: 'cust-1', isDefault: true },
        { isDefault: false },
      );
      expect(paymentMethodRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pm-other', isDefault: true }),
      );
    });
  });
});
