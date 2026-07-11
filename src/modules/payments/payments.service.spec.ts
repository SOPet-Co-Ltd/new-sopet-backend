import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { Payment } from '../../database/entities/payment.entity';
import { Order } from '../../database/entities/order.entity';
import { Customer } from '../../database/entities/customer.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentEventsService } from './payment-events.service';
import { InventoryService } from '../inventory/inventory.service';

const paymentEventsServiceMock = {
  publishPaymentStatusUpdated: jest.fn(),
};

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
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) => cb({})),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(Customer), useValue: { findOne: jest.fn() } },
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
        {
          provide: PaymentEventsService,
          useValue: paymentEventsServiceMock,
        },
        {
          provide: InventoryService,
          useValue: { restoreOrderStock: jest.fn().mockResolvedValue(true) },
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
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) => cb({})),
    },
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
        { provide: getRepositoryToken(Customer), useValue: { findOne: jest.fn() } },
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
        {
          provide: PaymentEventsService,
          useValue: paymentEventsServiceMock,
        },
        {
          provide: InventoryService,
          useValue: { restoreOrderStock: jest.fn().mockResolvedValue(true) },
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

describe('PaymentsService createCharge saved card', () => {
  let service: PaymentsService;
  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => Promise.resolve({ ...x, id: 'pay-1' })),
    findOne: jest.fn().mockResolvedValue(null),
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) => cb({})),
    },
  };
  const customerRepository = {
    findOne: jest.fn(),
  };
  const savedPaymentMethodRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chrg_test_1',
        status: 'pending',
      }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(Customer), useValue: customerRepository },
        {
          provide: getRepositoryToken(SavedPaymentMethod),
          useValue: savedPaymentMethodRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'omise.secretKey') return 'skey_test';
              if (key === 'omise.publicKey') return 'pkey_test';
              return '';
            }),
          },
        },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
        {
          provide: PaymentEventsService,
          useValue: paymentEventsServiceMock,
        },
        {
          provide: InventoryService,
          useValue: { restoreOrderStock: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('charges saved card using Omise customer and card id', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
      status: 'pending',
    });
    orderRepository.save.mockResolvedValue(undefined);
    savedPaymentMethodRepository.findOne.mockResolvedValue({
      id: 'saved-1',
      customerId: 'cust-1',
      omiseCardToken: 'card_test_68am5rb4ntc85gls2ly',
    });
    customerRepository.findOne.mockResolvedValue({
      id: 'cust-1',
      omiseCustomerId: 'cust_test_omise_1',
    });

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      savedPaymentMethodId: 'saved-1',
      customerId: 'cust-1',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.omise.co/charges',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          amount: 30000,
          currency: 'thb',
          customer: 'cust_test_omise_1',
          card: 'card_test_68am5rb4ntc85gls2ly',
        }),
      }),
    );
  });
});
