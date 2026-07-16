import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { buildOmiseReturnUri } from './build-omise-return-uri';
import { Payment } from '../../database/entities/payment.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Customer } from '../../database/entities/customer.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentEventsService } from './payment-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { PayoutsService } from '../payouts/payouts.service';
import { StoresService } from '../stores/stores.service';

const paymentEventsServiceMock = {
  publishPaymentStatusUpdated: jest.fn(),
};

const payoutsServiceMock = {
  handleOmiseTransferWebhook: jest.fn(),
};

const storesServiceMock = {
  handleOmiseRecipientWebhook: jest.fn(),
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
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
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
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
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

describe('PaymentsService createCharge return_uri', () => {
  let service: PaymentsService;
  let configGet: jest.Mock;
  const STOREFRONT_ORIGIN = 'https://shop.example.com';
  const PAYMENT_ID = 'pay-return-1';

  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => {
      Object.assign(x, { id: PAYMENT_ID });
      return Promise.resolve(x);
    }),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
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

  async function compileService(storefrontUrl: string | undefined) {
    configGet = jest.fn((key: string) => {
      if (key === 'omise.secretKey') return 'skey_test';
      if (key === 'omise.publicKey') return 'pkey_test';
      if (key === 'app.storefrontUrl') return storefrontUrl;
      return '';
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
          useValue: { get: configGet },
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
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  function parseChargeBody(): Record<string, unknown> {
    expect(global.fetch).toHaveBeenCalled();
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const rawBody = init.body;
    if (typeof rawBody !== 'string') {
      throw new Error(`expected string charge body, got ${typeof rawBody}`);
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 'chrg_test_1',
          status: 'pending',
        }),
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
      status: OrderStatus.PENDING_PAYMENT,
    });
    orderRepository.save.mockResolvedValue(undefined);
  });

  it('includes return_uri ending /payment/{paymentId} for credit_card + token', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_test_1',
      customerId: 'cust-1',
    });

    const body = parseChargeBody();
    expect(body.return_uri).toBe(`${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`);
    expect(String(body.return_uri)).toMatch(new RegExp(`/payment/${PAYMENT_ID}$`));
    expect(body.card).toBe('tokn_test_1');
  });

  it('includes return_uri ending /payment/{paymentId} for credit_card + saved card', async () => {
    service = await compileService(`${STOREFRONT_ORIGIN}/`);
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

    const body = parseChargeBody();
    expect(body).toEqual({
      amount: 30000,
      currency: 'thb',
      customer: 'cust_test_omise_1',
      card: 'card_test_68am5rb4ntc85gls2ly',
      return_uri: `${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`,
    });
  });

  it('omits return_uri for PromptPay createCharge', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    const body = parseChargeBody();
    expect(body).not.toHaveProperty('return_uri');
    expect(body.source).toEqual({ type: 'promptpay' });
  });

  it('does not call Omise (no return_uri leak) for COD', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    const result = await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'cod',
      customerId: 'cust-1',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.paymentMethod).toBe('cod');
  });

  it('fails loudly when app.storefrontUrl is missing for credit_card', async () => {
    service = await compileService(undefined);

    await expect(
      service.createCharge({
        orderId: 'ord-1',
        amount: 300,
        currency: 'THB',
        paymentMethod: 'credit_card',
        omiseToken: 'tokn_test_1',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'STOREFRONT_URL_NOT_CONFIGURED' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails loudly when app.storefrontUrl is empty for credit_card', async () => {
    service = await compileService('');

    await expect(
      service.createCharge({
        orderId: 'ord-1',
        amount: 300,
        currency: 'THB',
        paymentMethod: 'credit_card',
        omiseToken: 'tokn_test_1',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'STOREFRONT_URL_NOT_CONFIGURED' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('PaymentsService handleWebhook UD-001 fail', () => {
  let service: PaymentsService;
  let inventoryService: { restoreOrderStock: jest.Mock };
  let managerSave: jest.Mock;

  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => Promise.resolve(x)),
    findOne: jest.fn(),
    find: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };

  const CHARGE_ID = 'chrg_fail_1';

  async function compileService(omiseSecretKey: string) {
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };
    managerSave = jest.fn((entity: unknown) => Promise.resolve(entity));
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: { save: jest.Mock }) => Promise<void>) => {
        await cb({ save: managerSave });
      },
    );

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
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'omise.secretKey') return omiseSecretKey;
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
          useValue: inventoryService,
        },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('credit_card webhook+GET fail keeps PENDING_PAYMENT and does not restore stock', async () => {
    service = await compileService('skey_test');
    const order = {
      id: 'ord-card-1',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: CHARGE_ID,
    };
    const payment = {
      id: 'pay-card-1',
      orderId: 'ord-card-1',
      status: 'pending',
      paymentMethod: 'credit_card',
    };
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.findOne.mockResolvedValue(payment);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: CHARGE_ID, status: 'failed' }),
    });

    await service.handleWebhook({
      key: 'charge.fail',
      data: { object: 'charge', id: CHARGE_ID, status: 'failed' },
    });

    expect(payment.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(managerSave).toHaveBeenCalledWith(payment);
    expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(payment);
  });

  it('non-card (promptpay) webhook+GET fail cancels order and restores stock', async () => {
    service = await compileService('skey_test');
    const order = {
      id: 'ord-pp-1',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: CHARGE_ID,
    };
    const payment = {
      id: 'pay-pp-1',
      orderId: 'ord-pp-1',
      status: 'pending',
      paymentMethod: 'promptpay',
    };
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.findOne.mockResolvedValue(payment);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: CHARGE_ID, status: 'failed' }),
    });

    await service.handleWebhook({
      key: 'charge.fail',
      data: { object: 'charge', id: CHARGE_ID, status: 'failed' },
    });

    expect(payment.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-pp-1',
      expect.anything(),
      'Payment failed',
    );
  });

  it('GET charge fail causes no mutation (unavailable boundary)', async () => {
    service = await compileService('skey_test');
    const order = {
      id: 'ord-get-fail',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: CHARGE_ID,
    };
    const payment = {
      id: 'pay-get-fail',
      orderId: 'ord-get-fail',
      status: 'pending',
      paymentMethod: 'credit_card',
    };
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.findOne.mockResolvedValue(payment);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));

    await service.handleWebhook({
      key: 'charge.fail',
      data: { object: 'charge', id: CHARGE_ID, status: 'failed' },
    });

    expect(payment.status).toBe('pending');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('ignores fail webhook when order is already CANCELLED', async () => {
    service = await compileService('skey_test');
    const order = {
      id: 'ord-cancelled',
      status: OrderStatus.CANCELLED,
      paymentReference: CHARGE_ID,
    };
    const payment = {
      id: 'pay-cancelled',
      orderId: 'ord-cancelled',
      status: 'failed',
      paymentMethod: 'credit_card',
    };
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.findOne.mockResolvedValue(payment);
    global.fetch = jest.fn();

    await service.handleWebhook({
      key: 'charge.fail',
      data: { object: 'charge', id: CHARGE_ID, status: 'failed' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('ignores fail webhook when order is already REFUNDED', async () => {
    service = await compileService('skey_test');
    const order = {
      id: 'ord-refunded',
      status: OrderStatus.REFUNDED,
      paymentReference: CHARGE_ID,
    };
    const payment = {
      id: 'pay-refunded',
      orderId: 'ord-refunded',
      status: 'paid',
      paymentMethod: 'credit_card',
    };
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.findOne.mockResolvedValue(payment);
    global.fetch = jest.fn();

    await service.handleWebhook({
      key: 'charge.fail',
      data: { object: 'charge', id: CHARGE_ID, status: 'failed' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('PromptPay QR expiry still cancels and restores stock', async () => {
    service = await compileService('skey_test');
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const payment = {
      id: 'pay-qr-exp',
      orderId: 'ord-qr-exp',
      status: 'pending',
      paymentMethod: 'promptpay',
      createdAt,
      expiresAt: null,
    } as Payment;
    const order = {
      id: 'ord-qr-exp',
      status: OrderStatus.PENDING_PAYMENT,
    };
    orderRepository.findOne.mockResolvedValue(order);

    const updated = await service.expirePendingQrPaymentIfNeeded(payment);

    expect(updated.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-qr-exp',
      expect.anything(),
      'QR payment expired',
    );
  });
});

describe('PaymentsService createCharge Executable Supersede/Retry Rule', () => {
  let service: PaymentsService;
  let inventoryService: { restoreOrderStock: jest.Mock };
  const STOREFRONT_ORIGIN = 'https://shop.example.com';
  const PRIOR_PAYMENT_ID = 'pay-prior-pending';
  const NEW_PAYMENT_ID = 'pay-new-after-supersede';
  const OLD_CHARGE_ID = 'chrg_old_superseded';
  const NEW_CHARGE_ID = 'chrg_new_active';

  const order = {
    id: 'ord-supersede-1',
    customerId: 'cust-1',
    status: OrderStatus.PENDING_PAYMENT,
    paymentReference: OLD_CHARGE_ID as string | null,
  };

  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<void>) => cb({})),
    },
  };
  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  async function compileService() {
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };
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
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'omise.secretKey') return 'skey_test';
              if (key === 'omise.publicKey') return 'pkey_test';
              if (key === 'app.storefrontUrl') return STOREFRONT_ORIGIN;
              if (key === 'payment.qrExpiryMinutes') return 15;
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
          useValue: inventoryService,
        },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  function priorCardPending(): Payment {
    return {
      id: PRIOR_PAYMENT_ID,
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'pending',
      paymentMethod: 'credit_card',
      authorizeUri: 'https://pay.omise.co/old',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
    } as Payment;
  }

  function priorPromptPayPending(): Payment {
    return {
      id: PRIOR_PAYMENT_ID,
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'pending',
      paymentMethod: 'promptpay',
      qrCodeUrl: 'https://api.omise.co/qr/old',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as Payment;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order.status = OrderStatus.PENDING_PAYMENT;
    order.paymentReference = OLD_CHARGE_ID;
    orderRepository.findOne.mockResolvedValue(order);
    orderRepository.save.mockImplementation((o: typeof order) => Promise.resolve(o));
    paymentRepository.find.mockResolvedValue([]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.save.mockImplementation((p: Payment) => {
      if (!p.id) {
        Object.assign(p, { id: NEW_PAYMENT_ID });
      }
      return Promise.resolve(p);
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: NEW_CHARGE_ID,
          status: 'pending',
          authorize_uri: 'https://pay.omise.co/new',
        }),
    });
    service = await compileService();
  });

  it('pending credit_card + new token → prior failed + new paymentId + new Omise POST + paymentReference updated', async () => {
    const prior = priorCardPending();
    // Old I001 path would early-return this row; must never resume credit_card pending.
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_new_1',
      customerId: 'cust-1',
    });

    expect(prior.status).toBe('failed');
    expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(prior);
    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(result.paymentId).not.toBe(PRIOR_PAYMENT_ID);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [fetchUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(fetchUrl).toContain('/charges');
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('pending card + promptpay → prior failed + new PromptPay charge', async () => {
    const prior = priorCardPending();
    paymentRepository.find.mockResolvedValue([prior]);
    // PromptPay resume findOne: no matching PromptPay pending
    paymentRepository.findOne.mockResolvedValue(null);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    expect(prior.status).toBe('failed');
    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(result.paymentId).not.toBe(PRIOR_PAYMENT_ID);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    const rawBody = init.body;
    if (typeof rawBody !== 'string') {
      throw new Error(`expected string charge body, got ${typeof rawBody}`);
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body.source).toEqual({ type: 'promptpay' });
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('PromptPay pending resume → same id, no new POST (same-value)', async () => {
    const prior = priorPromptPayPending();
    paymentRepository.findOne.mockResolvedValue(prior);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    expect(result.paymentId).toBe(PRIOR_PAYMENT_ID);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(paymentRepository.find).not.toHaveBeenCalled();
    expect(prior.status).toBe('pending');
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('does not call Omise reverse on supersede (rollback-only visibility — local only)', async () => {
    const prior = priorCardPending();
    paymentRepository.find.mockResolvedValue([prior]);

    await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_new_1',
      customerId: 'cust-1',
    });

    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(paths.some((p) => p.includes('/reverse'))).toBe(false);
    // MVP orphan: superseded Omise charge is abandoned locally only (ops residual).
  });

  it('late unmatched old charge webhook does not invent paid (shared-state)', async () => {
    const prior = priorCardPending();
    paymentRepository.find.mockResolvedValue([prior]);

    await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_new_1',
      customerId: 'cust-1',
    });
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);

    // After pointer moved, webhook for superseded charge id finds no order (existing warn+return).
    orderRepository.findOne.mockResolvedValue(null);
    const warnSpy = jest.spyOn(
      (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
      'warn',
    );
    global.fetch = jest.fn();

    await service.handleWebhook({
      key: 'charge.complete',
      data: { object: 'charge', id: OLD_CHARGE_ID, status: 'successful' },
    });

    expect(warnSpy).toHaveBeenCalledWith(`No order for Omise charge ${OLD_CHARGE_ID}`);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(global.fetch).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('findLatestByOrderId prefers latest created payment after multi-payment (missing-sort-key)', async () => {
    const latest = {
      id: NEW_PAYMENT_ID,
      orderId: order.id,
      status: 'pending',
      paymentMethod: 'credit_card',
      createdAt: new Date('2026-07-15T11:00:00.000Z'),
    } as Payment;
    paymentRepository.findOne.mockResolvedValue(latest);

    const payment = await service.findLatestByOrderId(order.id, 'cust-1');

    expect(payment.id).toBe(NEW_PAYMENT_ID);
    expect(paymentRepository.findOne).toHaveBeenCalledWith({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
  });
});

describe('buildOmiseReturnUri', () => {
  it('strips trailing slash on origin', () => {
    expect(buildOmiseReturnUri('https://shop.example.com/', 'pay-1')).toBe(
      'https://shop.example.com/payment/pay-1',
    );
  });

  it('throws when origin is empty after normalize', () => {
    expect(() => buildOmiseReturnUri('/', 'pay-1')).toThrow('STOREFRONT_URL_EMPTY');
    expect(() => buildOmiseReturnUri('', 'pay-1')).toThrow('STOREFRONT_URL_EMPTY');
  });
});
