import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { Payment } from '../../database/entities/payment.entity';
import { Order } from '../../database/entities/order.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('PaymentsService guest access', () => {
  let service: PaymentsService;
  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => Promise.resolve({ ...x, id: 'pay-1' })),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        {
          provide: getRepositoryToken(SavedPaymentMethod),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => '') },
        },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('allows payment for guest orders without customerId', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: null,
    });

    const order = await service.assertCanPayForOrder('ord-1');
    expect(order.id).toBe('ord-1');
  });

  it('rejects payment when customer does not own the order', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
    });

    await expect(service.assertCanPayForOrder('ord-1', 'cust-2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects payment for customer-owned order without auth', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
    });

    await expect(service.assertCanPayForOrder('ord-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects unknown order', async () => {
    orderRepository.findOne.mockResolvedValue(null);
    await expect(service.assertCanPayForOrder('missing')).rejects.toThrow(BadRequestException);
  });
});

describe('PaymentsService payment read queries', () => {
  let service: PaymentsService;
  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => Promise.resolve({ ...x, id: 'pay-1' })),
    findOne: jest.fn(),
  };

  const guestOrder = { id: 'ord-1', customerId: null };
  const ownedOrder = { id: 'ord-2', customerId: 'cust-1' };
  const basePayment = {
    id: 'pay-1',
    orderId: 'ord-1',
    amount: 100,
    currency: 'THB',
    status: 'pending',
    paymentMethod: 'promptpay',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        {
          provide: getRepositoryToken(SavedPaymentMethod),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => '') },
        },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('findById', () => {
    it('returns payment for guest order without customerId', async () => {
      paymentRepository.findOne.mockResolvedValue(basePayment);
      orderRepository.findOne.mockResolvedValue(guestOrder);

      const payment = await service.findById('pay-1');

      expect(payment).toEqual(basePayment);
      expect(paymentRepository.findOne).toHaveBeenCalledWith({ where: { id: 'pay-1' } });
    });

    it('returns payment when authenticated customer owns the order', async () => {
      paymentRepository.findOne.mockResolvedValue({ ...basePayment, orderId: 'ord-2' });
      orderRepository.findOne.mockResolvedValue(ownedOrder);

      const payment = await service.findById('pay-1', 'cust-1');

      expect(payment.orderId).toBe('ord-2');
    });

    it('rejects when authenticated customer does not own the order', async () => {
      paymentRepository.findOne.mockResolvedValue({ ...basePayment, orderId: 'ord-2' });
      orderRepository.findOne.mockResolvedValue(ownedOrder);

      await expect(service.findById('pay-1', 'cust-2')).rejects.toThrow(ForbiddenException);
    });

    it('throws NOT_FOUND for invalid payment UUID', async () => {
      paymentRepository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findLatestByOrderId', () => {
    it('returns latest payment when order has multiple payments', async () => {
      orderRepository.findOne.mockResolvedValue(guestOrder);
      const latestPayment = { ...basePayment, id: 'pay-latest', status: 'paid' };
      paymentRepository.findOne.mockResolvedValue(latestPayment);

      const payment = await service.findLatestByOrderId('ord-1');

      expect(payment).toEqual(latestPayment);
      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: { orderId: 'ord-1' },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns payment for authenticated owner', async () => {
      orderRepository.findOne.mockResolvedValue(ownedOrder);
      paymentRepository.findOne.mockResolvedValue({ ...basePayment, orderId: 'ord-2' });

      const payment = await service.findLatestByOrderId('ord-2', 'cust-1');

      expect(payment.orderId).toBe('ord-2');
    });

    it('rejects cross-customer access', async () => {
      orderRepository.findOne.mockResolvedValue(ownedOrder);

      await expect(service.findLatestByOrderId('ord-2', 'cust-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NOT_FOUND when order has no payments', async () => {
      orderRepository.findOne.mockResolvedValue(guestOrder);
      paymentRepository.findOne.mockResolvedValue(null);

      await expect(service.findLatestByOrderId('ord-1')).rejects.toThrow(NotFoundException);
    });
  });
});
