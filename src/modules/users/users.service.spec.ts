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
import { PaymentsService } from '../payments/payments.service';
import { StorageService } from '../storage/storage.service';

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
  const jwtService = {
    verify: jest.fn(),
    signAsync: jest.fn(async (payload) => `token-${payload.type ?? 'reactivation'}`),
  };
  const configService = {
    get: jest.fn((key: string) => (key.includes('refresh') ? '7d' : '15m')),
  };
  const otpRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const ordersService = {
    mergeGuestOrders: jest.fn(),
  };
  const paymentsService = {
    saveCustomerCard: jest.fn(),
    deleteOmiseCustomerCard: jest.fn(),
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
        { provide: PaymentsService, useValue: paymentsService },
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
      code: '123456',
      isUsed: false,
    });

    const result = await service.changeCustomerPhone('cust-1', '0822222222', '123456');

    expect(result.customer.phone).toBe('0822222222');
    expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0811111111');
    expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0822222222');
    expect(result.accessToken).toBe('token-access');
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
    it('marks the first saved card as default automatically', async () => {
      paymentsService.saveCustomerCard.mockResolvedValue({
        omiseCardId: 'card_test_1',
        cardFingerprint: 'fp-1',
        lastFour: '4242',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });
      paymentMethodRepo.find.mockResolvedValue([]);

      const result = await service.addPaymentMethod('cust-1', {
        omiseCardToken: 'tokn_test_1',
        lastFour: '4242',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
        isDefault: false,
      });

      expect(result.isDefault).toBe(true);
      expect(paymentMethodRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isDefault: true }),
      );
    });

    it('restores a soft-deleted card instead of inserting a duplicate row', async () => {
      paymentsService.saveCustomerCard.mockResolvedValue({
        omiseCardId: 'card_test_restored',
        cardFingerprint: 'fp-restored',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });
      paymentMethodRepo.find.mockResolvedValue([]);
      paymentMethodQueryBuilder.getOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'pm-deleted',
          customerId: 'cust-1',
          deletedAt: new Date('2026-01-01'),
          isDefault: false,
        });

      const result = await service.addPaymentMethod('cust-1', {
        omiseCardToken: 'tokn_test_1',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });

      expect(paymentMethodRepo.restore).toHaveBeenCalledWith('pm-deleted');
      expect(result.omiseCardToken).toBe('card_test_restored');
      expect(result.isDefault).toBe(true);
    });

    it('returns an existing active card without calling Omise save', async () => {
      paymentMethodRepo.find.mockResolvedValue([
        { id: 'pm-existing', customerId: 'cust-1', isDefault: true },
      ]);
      paymentMethodQueryBuilder.getOne.mockResolvedValue({
        id: 'pm-existing',
        customerId: 'cust-1',
        isDefault: true,
      });

      const result = await service.addPaymentMethod('cust-1', {
        omiseCardToken: 'tokn_test_1',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });

      expect(paymentsService.saveCustomerCard).not.toHaveBeenCalled();
      expect(result.id).toBe('pm-existing');
    });

    it('returns an existing active card without inserting a duplicate row', async () => {
      paymentsService.saveCustomerCard.mockResolvedValue({
        omiseCardId: 'card_test_existing',
        cardFingerprint: 'fp-existing',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });
      paymentMethodRepo.find.mockResolvedValue([
        { id: 'pm-existing', customerId: 'cust-1', isDefault: true },
      ]);
      paymentMethodQueryBuilder.getOne.mockResolvedValue({
        id: 'pm-existing',
        customerId: 'cust-1',
        isDefault: true,
      });

      const result = await service.addPaymentMethod('cust-1', {
        omiseCardToken: 'tokn_test_1',
        lastFour: '1111',
        brand: 'visa',
        expiryMonth: 12,
        expiryYear: 2034,
      });

      expect(result.id).toBe('pm-existing');
      expect(paymentMethodRepo.create).not.toHaveBeenCalled();
    });

    it('promotes another card when the default card is deleted', async () => {
      paymentMethodRepo.findOne.mockResolvedValue({
        id: 'pm-default',
        customerId: 'cust-1',
        isDefault: true,
        omiseCardToken: 'card_test_default',
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

      expect(paymentsService.deleteOmiseCustomerCard).toHaveBeenCalledWith(
        'cust-1',
        'card_test_default',
      );
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
