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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(SavedAddress), useValue: {} },
        { provide: getRepositoryToken(SavedPaymentMethod), useValue: {} },
        { provide: getRepositoryToken(OtpCode), useValue: otpRepo },
        { provide: CustomerRepository, useValue: customerRepository },
        { provide: OrdersService, useValue: ordersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
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
});
