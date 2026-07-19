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

/** EntityManager mock for Phase B FOR UPDATE createCharge path. */
function createPhaseBManagerMock(deps: {
  orderRepository: { findOne: jest.Mock; save: jest.Mock };
  paymentRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
}) {
  return {
    findOne: jest.fn((entity: unknown, options?: unknown): Promise<unknown> => {
      if (entity === Order) {
        return Promise.resolve(deps.orderRepository.findOne(options) as unknown);
      }
      if (entity === Payment) {
        return Promise.resolve(deps.paymentRepository.findOne(options) as unknown);
      }
      return Promise.resolve(null);
    }),
    find: jest.fn((entity: unknown, options?: unknown): Promise<unknown[]> => {
      if (entity === Payment) {
        return Promise.resolve(deps.paymentRepository.find(options) as unknown[]);
      }
      return Promise.resolve([]);
    }),
    create: jest.fn(
      (_entity: unknown, data: unknown): Payment =>
        deps.paymentRepository.create(data as Payment) as Payment,
    ),
    save: jest.fn((entity: { orderId?: string }): Promise<unknown> => {
      if (entity && typeof entity === 'object' && 'orderId' in entity) {
        return Promise.resolve(deps.paymentRepository.save(entity) as unknown);
      }
      return Promise.resolve(deps.orderRepository.save(entity) as unknown);
    }),
  };
}

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
    const createCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]: [string]) =>
        typeof url === 'string' &&
        url.includes('/charges') &&
        !url.includes('/expire') &&
        !url.includes('/reverse'),
    ) as [string, RequestInit] | undefined;
    if (!createCall) {
      throw new Error('expected Omise create charge fetch call');
    }
    const [, init] = createCall;
    const rawBody = init.body;
    if (typeof rawBody !== 'string') {
      throw new Error(`expected string charge body, got ${typeof rawBody}`);
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: ReturnType<typeof createPhaseBManagerMock>) => Promise<unknown>) =>
        cb(createPhaseBManagerMock({ orderRepository, paymentRepository })),
    );
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
              if (key === 'payment.omiseCancelTimeoutMs') return 4000;
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
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: ReturnType<typeof createPhaseBManagerMock>) => Promise<unknown>) =>
        cb(createPhaseBManagerMock({ orderRepository, paymentRepository })),
    );
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && (url.includes('/expire') || url.includes('/reverse'))) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: OLD_CHARGE_ID, status: 'expired' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: NEW_CHARGE_ID,
            status: 'pending',
            authorize_uri: 'https://pay.omise.co/new',
          }),
      });
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
    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(paths.some((p) => p.includes('/expire') || p.includes('/reverse'))).toBe(true);
    expect(
      paths.some(
        (p) => p.includes('/charges') && !p.includes('/expire') && !p.includes('/reverse'),
      ),
    ).toBe(true);
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(order.paymentMethod).toBe('credit_card');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    const savedPayments = paymentRepository.save.mock.calls.map((c: [Payment]) => c[0]);
    const created = savedPayments.find((p) => p.id === NEW_PAYMENT_ID);
    expect(created?.omiseChargeId).toBe(NEW_CHARGE_ID);
  });

  it('pending card + promptpay → prior failed + new PromptPay charge', async () => {
    const prior = priorCardPending();
    paymentRepository.find.mockResolvedValue([prior]);
    // Eligibility latest-payment findOne: prior pending is eligible
    paymentRepository.findOne.mockResolvedValue(prior);

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
    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(
      paths.some(
        (p) => p.includes('/charges') && !p.includes('/expire') && !p.includes('/reverse'),
      ),
    ).toBe(true);
    const createCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]: [string]) =>
        url.includes('/charges') && !url.includes('/expire') && !url.includes('/reverse'),
    ) as [string, RequestInit];
    const rawBody = createCall[1].body;
    if (typeof rawBody !== 'string') {
      throw new Error(`expected string charge body, got ${typeof rawBody}`);
    }
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    expect(body.source).toEqual({ type: 'promptpay' });
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(order.paymentMethod).toBe('promptpay');
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('PromptPay pending restart → new paymentId + prior failed + new Omise POST (no soft-resume)', async () => {
    // Amended unpaid-switch contract (BE-UPMS-001): never soft-resume same pending PromptPay.
    const prior = priorPromptPayPending();
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(result.paymentId).not.toBe(PRIOR_PAYMENT_ID);
    expect(prior.status).toBe('failed');
    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(
      paths.some(
        (p) => p.includes('/charges') && !p.includes('/expire') && !p.includes('/reverse'),
      ),
    ).toBe(true);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(paymentRepository.findOne).toHaveBeenCalledWith({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
  });

  it('Omise createCharge rejects with ORDER_NOT_PAYABLE when latest payment is paid', async () => {
    const paidLatest = {
      id: 'pay-paid-latest',
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'paid',
      paymentMethod: 'credit_card',
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
    } as Payment;
    paymentRepository.findOne.mockResolvedValue(paidLatest);

    await expect(
      service.createCharge({
        orderId: order.id,
        amount: 300,
        currency: 'THB',
        paymentMethod: 'credit_card',
        omiseToken: 'tokn_new_1',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(paymentRepository.findOne).toHaveBeenCalledWith({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
  });

  it('COD createCharge rejects with ORDER_NOT_PAYABLE when latest payment is paid', async () => {
    const paidLatest = {
      id: 'pay-paid-latest-cod',
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'paid',
      paymentMethod: 'promptpay',
      createdAt: new Date('2026-07-15T12:00:00.000Z'),
    } as Payment;
    paymentRepository.findOne.mockResolvedValue(paidLatest);

    await expect(
      service.createCharge({
        orderId: order.id,
        amount: 300,
        currency: 'THB',
        paymentMethod: 'cod',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('COD createCharge rejects with ORDER_NOT_PAYABLE when order is not pending_payment', async () => {
    order.status = OrderStatus.PAID;
    paymentRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createCharge({
        orderId: order.id,
        amount: 300,
        currency: 'THB',
        paymentMethod: 'cod',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

    expect(paymentRepository.create).not.toHaveBeenCalled();
  });

  it('attempts Omise expire/reverse on supersede before create (fail-open still creates)', async () => {
    // Amended unpaid-switch contract (BE-UPMS-002): cancel-before-create + fail-open.
    const prior = priorCardPending();
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const callOrder: string[] = [];
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: ReturnType<typeof createPhaseBManagerMock>) => Promise<unknown>) => {
        callOrder.push('phase_b_transaction');
        return cb(createPhaseBManagerMock({ orderRepository, paymentRepository }));
      },
    );
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && (url.includes('/expire') || url.includes('/reverse'))) {
        callOrder.push('phase_a_cancel');
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ message: 'expire unsupported' }),
        });
      }
      callOrder.push('omise_create');
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: NEW_CHARGE_ID,
            status: 'pending',
            authorize_uri: 'https://pay.omise.co/new',
          }),
      });
    });

    const warnSpy = jest.spyOn(
      (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
      'warn',
    );

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_new_1',
      customerId: 'cust-1',
    });

    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(paths.some((p) => p.includes('/expire') || p.includes('/reverse'))).toBe(true);
    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(prior.status).toBe('failed');
    expect(
      paths.some(
        (p) => p.includes('/charges') && !p.includes('/expire') && !p.includes('/reverse'),
      ),
    ).toBe(true);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(callOrder.indexOf('phase_a_cancel')).toBeGreaterThanOrEqual(0);
    expect(callOrder.indexOf('phase_a_cancel')).toBeLessThan(
      callOrder.indexOf('phase_b_transaction'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('omise_cancel_fail_open'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(order.id));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(PRIOR_PAYMENT_ID));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(OLD_CHARGE_ID));
    warnSpy.mockRestore();
  });

  it('fail-open: expire 4xx still creates new payment', async () => {
    const prior = priorPromptPayPending();
    prior.omiseChargeId = OLD_CHARGE_ID;
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/expire')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ message: 'failed_expire' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: NEW_CHARGE_ID,
            status: 'pending',
          }),
      });
    });

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(prior.status).toBe('failed');
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
  });

  it('charge-id resolution: prefers payment.omiseChargeId over order.paymentReference', async () => {
    const prior = priorCardPending();
    prior.omiseChargeId = 'chrg_from_payment_column';
    order.paymentReference = 'chrg_stale_order_ref';
    paymentRepository.findOne.mockResolvedValue(prior);
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
    expect(paths.some((p) => p.includes('/charges/chrg_from_payment_column/'))).toBe(true);
    expect(paths.some((p) => p.includes('/charges/chrg_stale_order_ref/'))).toBe(false);
  });

  it('charge-id resolution: skips Omise cancel when multi-pending without omiseChargeId', async () => {
    const priorA = priorCardPending();
    const priorB = {
      ...priorPromptPayPending(),
      id: 'pay-prior-2',
    };
    delete (priorA as { omiseChargeId?: string | null }).omiseChargeId;
    delete (priorB as { omiseChargeId?: string | null }).omiseChargeId;
    paymentRepository.findOne.mockResolvedValue(priorB);
    paymentRepository.find.mockResolvedValue([priorA, priorB]);

    await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      omiseToken: 'tokn_new_1',
      customerId: 'cust-1',
    });

    const paths = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(paths.every((p) => !p.includes('/expire') && !p.includes('/reverse'))).toBe(true);
    expect(
      paths.some(
        (p) => p.includes('/charges') && !p.includes('/expire') && !p.includes('/reverse'),
      ),
    ).toBe(true);
  });

  it('Omise→COD clears order.paymentReference and syncs paymentMethod; omiseChargeId absent', async () => {
    const prior = priorCardPending();
    prior.omiseChargeId = OLD_CHARGE_ID;
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'cod',
      customerId: 'cust-1',
    });

    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(prior.status).toBe('failed');
    expect(order.paymentMethod).toBe('cod');
    expect(order.paymentReference).toBeNull();
    const savedPayments = paymentRepository.save.mock.calls.map((c: [Payment]) => c[0]);
    const created = savedPayments.find((p) => p.id === NEW_PAYMENT_ID);
    expect(created?.omiseChargeId ?? null).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('COD after Omise: orphan webhook for prior charge still warn+return (no invent-paid)', async () => {
    const prior = priorCardPending();
    prior.omiseChargeId = OLD_CHARGE_ID;
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'cod',
      customerId: 'cust-1',
    });
    expect(order.paymentReference).toBeNull();

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
