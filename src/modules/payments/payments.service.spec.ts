import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { buildPaymentReturnUri } from './build-payment-return-uri';
import { BeamService, type BeamCreateChargeBody } from '../beam/beam.service';
import { Payment } from '../../database/entities/payment.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { Customer } from '../../database/entities/customer.entity';
import { SavedPaymentMethod } from '../../database/entities/saved-payment-method.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DashboardEventsService } from '../dashboard-events/dashboard-events.service';
import { PaymentEventsService } from './payment-events.service';
import { InventoryService } from '../inventory/inventory.service';
import { PayoutsService } from '../payouts/payouts.service';
import { StoresService } from '../stores/stores.service';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { BankTransferSettingsService } from '../platform/bank-transfer-settings.service';
import { OrderAuditLogsService } from '../order-audit-logs/order-audit-logs.service';
import { OrderAuditLog } from '../../database/entities/order-audit-log.entity';

function guestPayFixture(plaintext = 'a'.repeat(64)) {
  return {
    plaintext,
    hash: createHash('sha256').update(plaintext).digest('hex'),
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  };
}

const paymentEventsServiceMock = {
  publishPaymentStatusUpdated: jest.fn(),
};

const payoutsServiceMock = {};

const storesServiceMock = {};

const beamServiceMock = {
  hasCredentials: jest.fn().mockReturnValue(true),
  createCharge: jest.fn(),
  getCharge: jest.fn(),
};

const orderAuditLogsServiceMock = {
  append: jest.fn().mockResolvedValue(undefined),
  resolveCustomerActorLabel: jest.fn().mockResolvedValue('ลูกค้า'),
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
      if (entity === OrderItem || (entity as { name?: string })?.name === 'OrderItem') {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
    create: jest.fn((_entity: unknown, data: unknown) => {
      if (_entity === OrderAuditLog) {
        return data;
      }
      return deps.paymentRepository.create(data);
    }),
    save: jest.fn((entityOrType: unknown, maybeData?: unknown): Promise<unknown> => {
      if (entityOrType === OrderAuditLog) {
        return Promise.resolve(maybeData);
      }
      const entity = (maybeData ?? entityOrType) as { orderId?: string };
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
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
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
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('rejects payment for guest orders without a guest pay token hash', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: null,
      guestPhone: '0812345678',
      guestPayTokenHash: null,
    });

    await expect(service.assertCanPayForOrder('ord-1')).rejects.toThrow(ForbiddenException);
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

  it('rejects unauthenticated access to a guest order linked to a member when hash is null', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'member-1',
      guestPhone: '0812345678',
      guestPayTokenHash: null,
    });

    await expect(service.assertCanPayForOrder('ord-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a different authenticated customer for a linked guest order', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'member-1',
      guestPhone: '0812345678',
      guestPayTokenHash: null,
    });

    await expect(service.assertCanPayForOrder('ord-1', 'cust-2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows owner JWT without guest pay token', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
      guestPhone: '0812345678',
      guestPayTokenHash: 'abc',
      guestPayTokenExpiresAt: new Date(Date.now() + 60_000),
    });

    const order = await service.assertCanPayForOrder('ord-1', 'cust-1');
    expect(order.id).toBe('ord-1');
  });

  it('requires matching guest pay token when hash is set', async () => {
    const { createHash } = await import('node:crypto');
    const plaintext = 'a'.repeat(64);
    const hash = createHash('sha256').update(plaintext).digest('hex');
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: null,
      guestPhone: '0812345678',
      guestPayTokenHash: hash,
      guestPayTokenExpiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.assertCanPayForOrder('ord-1')).rejects.toThrow(ForbiddenException);
    await expect(service.assertCanPayForOrder('ord-1', undefined, 'b'.repeat(64))).rejects.toThrow(
      ForbiddenException,
    );

    const order = await service.assertCanPayForOrder('ord-1', undefined, plaintext);
    expect(order.id).toBe('ord-1');
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

  const guestPay = guestPayFixture();
  const guestPayPlaintext = guestPay.plaintext;
  const guestOrder = {
    id: 'ord-1',
    customerId: null,
    guestPhone: '0812345678',
    guestPayTokenHash: guestPay.hash,
    guestPayTokenExpiresAt: guestPay.expiresAt,
  };
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
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
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
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('findById', () => {
    it('returns payment for guest order without customerId', async () => {
      paymentRepository.findOne.mockResolvedValue(basePayment);
      orderRepository.findOne.mockResolvedValue(guestOrder);

      const payment = await service.findById('pay-1', undefined, guestPayPlaintext);

      expect(payment).toEqual(basePayment);
      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        relations: ['order'],
      });
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

      const payment = await service.findLatestByOrderId('ord-1', undefined, guestPayPlaintext);

      expect(payment).toEqual(latestPayment);
      expect(paymentRepository.findOne).toHaveBeenCalledWith({
        where: { orderId: 'ord-1' },
        order: { createdAt: 'DESC' },
        relations: ['order'],
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

      await expect(
        service.findLatestByOrderId('ord-1', undefined, guestPayPlaintext),
      ).rejects.toThrow(NotFoundException);
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
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb({})),
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
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
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
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  function chargeBody(): BeamCreateChargeBody {
    expect(beamServiceMock.createCharge).toHaveBeenCalled();
    return beamServiceMock.createCharge.mock.calls[0][0] as BeamCreateChargeBody;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: ReturnType<typeof createPhaseBManagerMock>) => Promise<unknown>) =>
        cb(createPhaseBManagerMock({ orderRepository, paymentRepository })),
    );
    global.fetch = jest.fn();
    beamServiceMock.hasCredentials.mockReturnValue(true);
    beamServiceMock.createCharge.mockResolvedValue({
      chargeId: 'beam_chrg_1',
      status: 'PENDING',
      actionRequired: 'NONE',
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      customerId: 'cust-1',
      status: OrderStatus.PENDING_PAYMENT,
      total: 300,
    });
    orderRepository.save.mockResolvedValue(undefined);
  });

  it('binds Beam charge amount to order.total ignoring client underpay', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 1,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    const body = chargeBody();
    expect(body.amount).toBe(30000);
    expect(body.currency).toBe('THB');
    expect(body.referenceId).toBe(PAYMENT_ID);
    const savedPayment = paymentRepository.save.mock.calls
      .map((c: [Payment]) => c[0])
      .find((p) => p.pspChargeId === 'beam_chrg_1' || p.amount === 300);
    expect(savedPayment?.amount).toBe(300);
    expect(savedPayment?.psp).toBe('beam');
    expect(savedPayment?.pspChargeId).toBe('beam_chrg_1');
    expect(savedPayment?.omiseChargeId).toBeUndefined();
  });

  it('binds Beam charge amount to order.total ignoring client overpay', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 9999,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    expect(chargeBody().amount).toBe(30000);
  });

  it('builds CARD_TOKEN charge with returnUrl and security code for credit_card + token', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      cardToken: 'tok_beam_1',
      cardSecurityCode: '123',
      customerId: 'cust-1',
    });

    const body = chargeBody();
    expect(body.returnUrl).toBe(`${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`);
    expect(body.skip3dsFlow).toBe(false);
    expect(body.paymentMethod).toEqual({
      paymentMethodType: 'CARD_TOKEN',
      cardToken: { cardTokenId: 'tok_beam_1', securityCode: '123' },
    });
  });

  it('uses saved Beam card token for credit_card + saved card', async () => {
    service = await compileService(`${STOREFRONT_ORIGIN}/`);
    savedPaymentMethodRepository.findOne.mockResolvedValue({
      id: 'saved-1',
      customerId: 'cust-1',
      psp: 'beam',
      pspCardToken: 'tok_saved_1',
    });

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      savedPaymentMethodId: 'saved-1',
      cardSecurityCode: '456',
      customerId: 'cust-1',
    });

    expect(chargeBody()).toEqual({
      amount: 30000,
      currency: 'THB',
      referenceId: PAYMENT_ID,
      returnUrl: `${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`,
      skip3dsFlow: false,
      paymentMethod: {
        paymentMethodType: 'CARD_TOKEN',
        cardToken: { cardTokenId: 'tok_saved_1', securityCode: '456' },
      },
    });
  });

  it('rejects saved methods that are not Beam with SAVED_CARD_PROVIDER_UNSUPPORTED', async () => {
    service = await compileService(STOREFRONT_ORIGIN);
    savedPaymentMethodRepository.findOne.mockResolvedValue({
      id: 'saved-1',
      customerId: 'cust-1',
      psp: 'omise',
      omiseCardToken: 'card_old',
    });

    await expect(
      service.createCharge({
        orderId: 'ord-1',
        amount: 300,
        currency: 'THB',
        paymentMethod: 'credit_card',
        savedPaymentMethodId: 'saved-1',
        cardSecurityCode: '456',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'SAVED_CARD_PROVIDER_UNSUPPORTED' } });
    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
  });

  it('requires cardSecurityCode for credit_card', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await expect(
      service.createCharge({
        orderId: 'ord-1',
        amount: 300,
        currency: 'THB',
        paymentMethod: 'credit_card',
        cardToken: 'tok_beam_1',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'CARD_SECURITY_CODE_REQUIRED' } });
    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
  });

  it('builds QR_PROMPT_PAY charge with expiryTime and persists qrCodeImage', async () => {
    service = await compileService(STOREFRONT_ORIGIN);
    beamServiceMock.createCharge.mockResolvedValue({
      chargeId: 'beam_chrg_qr',
      status: 'PENDING',
      actionRequired: 'ENCODED_IMAGE',
      encodedImage: { imageBase64Encoded: 'BASE64QR' },
    });

    const result = await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'promptpay',
      customerId: 'cust-1',
    });

    const body = chargeBody();
    expect(body.paymentMethod.paymentMethodType).toBe('QR_PROMPT_PAY');
    const expiry = body.paymentMethod.qrPromptPay?.expiryTime;
    expect(typeof expiry).toBe('string');
    expect(new Date(expiry as string).getTime()).toBeGreaterThan(Date.now());
    expect(result.qrCodeImage).toBe('BASE64QR');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ paymentReference: 'beam_chrg_qr' }),
    );
  });

  it('throws BEAM_NOT_CONFIGURED for online methods without credentials', async () => {
    service = await compileService(STOREFRONT_ORIGIN);
    beamServiceMock.hasCredentials.mockReturnValue(false);

    await expect(
      service.createCharge({
        orderId: 'ord-1',
        amount: 300,
        currency: 'THB',
        paymentMethod: 'promptpay',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'BEAM_NOT_CONFIGURED' } });
    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
  });

  it('marks order paid when Beam charge succeeds immediately', async () => {
    service = await compileService(STOREFRONT_ORIGIN);
    beamServiceMock.createCharge.mockResolvedValue({
      chargeId: 'beam_chrg_ok',
      status: 'SUCCEEDED',
      actionRequired: 'NONE',
    });

    const result = await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      cardToken: 'tok_beam_1',
      cardSecurityCode: '123',
      customerId: 'cust-1',
    });

    expect(result.status).toBe('paid');
    expect(orderRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.PAID, paymentReference: 'beam_chrg_ok' }),
    );
  });

  it('does not call Beam (no returnUrl leak) for COD', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    const result = await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'cod',
      customerId: 'cust-1',
    });

    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.paymentMethod).toBe('cod');
  });

  it('does not call Beam for bank_transfer', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    const result = await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'bank_transfer',
      customerId: 'cust-1',
    });

    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
    expect(result.paymentId).toBe(PAYMENT_ID);
    expect(result.paymentMethod).toBe('bank_transfer');
  });

  it.each([undefined, ''])(
    'fails loudly when app.storefrontUrl is %p for credit_card',
    async (storefrontUrl) => {
      service = await compileService(storefrontUrl);

      await expect(
        service.createCharge({
          orderId: 'ord-1',
          amount: 300,
          currency: 'THB',
          paymentMethod: 'credit_card',
          cardToken: 'tok_beam_1',
          cardSecurityCode: '123',
          customerId: 'cust-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'STOREFRONT_URL_NOT_CONFIGURED' } });
      expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
    },
  );

  it('creates TRUE_MONEY charge with returnUrl', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'truemoney',
      customerId: 'cust-1',
    });

    const body = chargeBody();
    expect(body.paymentMethod).toEqual({ paymentMethodType: 'TRUE_MONEY', trueMoney: {} });
    expect(body.returnUrl).toBe(`${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`);
  });

  it('creates SHOPEE_PAY charge with returnUrl', async () => {
    service = await compileService(STOREFRONT_ORIGIN);

    await service.createCharge({
      orderId: 'ord-1',
      amount: 300,
      currency: 'THB',
      paymentMethod: 'shopeepay',
      customerId: 'cust-1',
    });

    const body = chargeBody();
    expect(body.paymentMethod).toEqual({ paymentMethodType: 'SHOPEE_PAY', shopeePay: {} });
    expect(body.returnUrl).toBe(`${STOREFRONT_ORIGIN}/payment/${PAYMENT_ID}`);
  });
});

describe('PaymentsService handleBeamWebhook UD-001 fail', () => {
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

  async function compileService() {
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
            get: jest.fn(() => ''),
          },
        },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
        {
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
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
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    beamServiceMock.getCharge.mockReset();
  });

  it('credit_card webhook+GET FAILED keeps PENDING_PAYMENT and does not restore stock', async () => {
    service = await compileService();
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
    beamServiceMock.getCharge.mockResolvedValue({ chargeId: CHARGE_ID, status: 'FAILED' });

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(payment.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentReference).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(managerSave).toHaveBeenCalledWith(payment);
    expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(payment);
  });

  it('promptpay webhook+GET FAILED keeps PENDING_PAYMENT for new QR retry (no stock restore)', async () => {
    service = await compileService();
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
    beamServiceMock.getCharge.mockResolvedValue({ chargeId: CHARGE_ID, status: 'FAILED' });

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(payment.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentReference).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('GET charge fail causes no mutation (unavailable boundary)', async () => {
    service = await compileService();
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
    beamServiceMock.getCharge.mockRejectedValue(new Error('network down'));

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(payment.status).toBe('pending');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it.each([OrderStatus.CANCELLED, OrderStatus.REFUNDED])(
    'ignores webhook when order is already %s (no invent-paid)',
    async (status) => {
      service = await compileService();
      const order = {
        id: 'ord-terminal',
        status,
        paymentReference: CHARGE_ID,
      };
      const payment = {
        id: 'pay-terminal',
        orderId: 'ord-terminal',
        status: 'pending',
        paymentMethod: 'promptpay',
      };
      orderRepository.findOne.mockResolvedValue(order);
      paymentRepository.findOne.mockResolvedValue(payment);

      await service.handleBeamWebhook({ chargeId: CHARGE_ID });

      expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
      expect(order.status).toBe(status);
      expect(payment.status).toBe('pending');
      expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    },
  );

  it('PromptPay QR expiry fails payment only and keeps order pending for new QR', async () => {
    service = await compileService();
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const payment = {
      id: 'pay-qr-exp',
      orderId: 'ord-qr-exp',
      status: 'pending',
      paymentMethod: 'promptpay',
      psp: 'beam',
      pspChargeId: 'chrg_qr_exp',
      createdAt,
      expiresAt: null,
    } as Payment;
    const order = {
      id: 'ord-qr-exp',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: 'chrg_qr_exp',
    };
    orderRepository.findOne.mockResolvedValue(order);

    const updated = await service.expirePendingQrPaymentIfNeeded(payment);

    expect(updated.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentReference).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('QR expire nulls paymentReference so late webhook cannot invent paid', async () => {
    service = await compileService();
    const chargeId = 'chrg_qr_orphan';
    const createdAt = new Date(Date.now() - 20 * 60 * 1000);
    const payment = {
      id: 'pay-qr-orphan',
      orderId: 'ord-qr-orphan',
      status: 'pending',
      paymentMethod: 'promptpay',
      psp: 'beam',
      pspChargeId: chargeId,
      createdAt,
      expiresAt: null,
    } as Payment;
    const order = {
      id: 'ord-qr-orphan',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: chargeId,
    };
    orderRepository.findOne.mockResolvedValue(order);

    await service.expirePendingQrPaymentIfNeeded(payment);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentReference).toBeNull();

    // After clear, webhook lookup by paymentReference finds no order (orphan warn+return).
    orderRepository.findOne.mockResolvedValue(null);
    paymentRepository.findOne.mockResolvedValue(null);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await service.handleBeamWebhook({ chargeId });

    expect(warnSpy).toHaveBeenCalledWith(`No order/payment for Beam charge ${chargeId}`);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
    warnSpy.mockRestore();
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
    paymentMethod: null as string | null,
    total: 300,
  };

  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    manager: {
      transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) => cb({})),
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
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
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
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
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
      psp: 'beam',
      pspChargeId: OLD_CHARGE_ID,
      authorizeUri: 'https://secure.beamcheckout.com/old',
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
      psp: 'beam',
      pspChargeId: OLD_CHARGE_ID,
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
    global.fetch = jest.fn();
    beamServiceMock.hasCredentials.mockReturnValue(true);
    beamServiceMock.createCharge.mockResolvedValue({
      chargeId: NEW_CHARGE_ID,
      status: 'PENDING',
      actionRequired: 'REDIRECT',
      redirect: { redirectUrl: 'https://pay.beam.example/new' },
    });
    service = await compileService();
  });

  it('pending credit_card + new token → prior failed + new paymentId + new Beam charge + paymentReference updated', async () => {
    const prior = priorCardPending();
    // Old I001 path would early-return this row; must never resume credit_card pending.
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      cardToken: 'tok_beam_1',
      cardSecurityCode: '123',
      customerId: 'cust-1',
    });

    expect(prior.status).toBe('failed');
    expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(prior);
    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(result.paymentId).not.toBe(PRIOR_PAYMENT_ID);
    expect(beamServiceMock.createCharge).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(order.paymentMethod).toBe('credit_card');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    const savedPayments = paymentRepository.save.mock.calls.map((c: [Payment]) => c[0]);
    const created = savedPayments.find((p) => p.id === NEW_PAYMENT_ID);
    expect(created?.psp).toBe('beam');
    expect(created?.pspChargeId).toBe(NEW_CHARGE_ID);
    expect(created?.authorizeUri).toBe('https://pay.beam.example/new');
    expect(created?.omiseChargeId).toBeUndefined();
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
    expect(beamServiceMock.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: expect.objectContaining({ paymentMethodType: 'QR_PROMPT_PAY' }),
      }),
    );
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(order.paymentMethod).toBe('promptpay');
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('PromptPay pending restart → new paymentId + prior failed + new Beam charge (no soft-resume)', async () => {
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
    expect(beamServiceMock.createCharge).toHaveBeenCalledTimes(1);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(paymentRepository.findOne).toHaveBeenCalledWith({
      where: { orderId: order.id },
      order: { createdAt: 'DESC' },
    });
  });

  it('Beam createCharge rejects with ORDER_NOT_PAYABLE when latest payment is paid', async () => {
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
        cardToken: 'tok_beam_1',
        cardSecurityCode: '123',
        customerId: 'cust-1',
      }),
    ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

    expect(paymentRepository.create).not.toHaveBeenCalled();
    expect(beamServiceMock.createCharge).not.toHaveBeenCalled();
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

  it('supersede is local only: no provider expire/reverse calls, still creates Beam charge', async () => {
    const prior = priorCardPending();
    paymentRepository.findOne.mockResolvedValue(prior);
    paymentRepository.find.mockResolvedValue([prior]);

    const result = await service.createCharge({
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      paymentMethod: 'credit_card',
      cardToken: 'tok_beam_1',
      cardSecurityCode: '123',
      customerId: 'cust-1',
    });

    expect(result.paymentId).toBe(NEW_PAYMENT_ID);
    expect(prior.status).toBe('failed');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(beamServiceMock.createCharge).toHaveBeenCalledTimes(1);
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('card→COD clears order.paymentReference and syncs paymentMethod; pspChargeId absent', async () => {
    const prior = priorCardPending();
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
    expect(created?.pspChargeId ?? null).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('COD after card: orphan webhook for prior charge still warn+return (no invent-paid)', async () => {
    const prior = priorCardPending();
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
    paymentRepository.findOne.mockResolvedValue(null);

    await service.handleBeamWebhook({ chargeId: OLD_CHARGE_ID });

    expect(warnSpy).toHaveBeenCalledWith(`No order/payment for Beam charge ${OLD_CHARGE_ID}`);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
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
      cardToken: 'tok_beam_1',
      cardSecurityCode: '123',
      customerId: 'cust-1',
    });
    expect(order.paymentReference).toBe(NEW_CHARGE_ID);

    // After pointer moved, webhook for superseded charge id finds no order (warn+return).
    orderRepository.findOne.mockResolvedValue(null);
    paymentRepository.findOne.mockResolvedValue(null);
    const warnSpy = jest.spyOn(
      (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
      'warn',
    );

    await service.handleBeamWebhook({ chargeId: OLD_CHARGE_ID });

    expect(warnSpy).toHaveBeenCalledWith(`No order/payment for Beam charge ${OLD_CHARGE_ID}`);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
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
      relations: ['order'],
    });
  });
});

describe('PaymentsService cancelStaleUnpaidOrders (AC-019–021)', () => {
  let service: PaymentsService;
  let inventoryService: { restoreOrderStock: jest.Mock };
  let managerSave: jest.Mock;
  let configGet: jest.Mock;

  const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
  const NOW = new Date('2026-07-20T00:00:00.000Z');

  const orderRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
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

  async function compileService() {
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };
    managerSave = jest.fn((entity: unknown) => Promise.resolve(entity));
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: { save: jest.Mock }) => Promise<void>) => {
        await cb({ save: managerSave });
      },
    );
    configGet = jest.fn((key: string) => {
      if (key === 'payment.unpaidOrderCancelAfterMs') return 86_400_000;
      if (key === 'payment.qrExpiryMinutes') return 15;
      return '';
    });

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
        { provide: ConfigService, useValue: { get: configGet } },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
        {
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: PaymentEventsService, useValue: paymentEventsServiceMock },
        { provide: InventoryService, useValue: inventoryService },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    return module.get(PaymentsService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    service = await compileService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('cancels stale unpaid PENDING_PAYMENT and restores stock once', async () => {
    const staleOrder = {
      id: 'ord-stale-1',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      paymentReference: 'chrg_stale_1',
      items: [{ id: 'i1', fulfillmentStatus: 'pending' }],
    };
    const pendingPayment = {
      id: 'pay-stale-1',
      orderId: 'ord-stale-1',
      status: 'pending',
      paymentMethod: 'credit_card',
    } as Payment;

    orderRepository.find.mockResolvedValue([staleOrder]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockResolvedValue([pendingPayment]);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(1);
    expect(staleOrder.status).toBe(OrderStatus.CANCELLED);
    expect(staleOrder.paymentReference).toBeNull();
    expect(pendingPayment.status).toBe('failed');
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledTimes(1);
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-stale-1',
      expect.anything(),
      'Unpaid order expired',
    );
    expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(
      pendingPayment,
    );
  });

  it('skips young unpaid orders within the 24h window', async () => {
    orderRepository.find.mockResolvedValue([]);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(0);
    const findCall = orderRepository.find.mock.calls[0] as
      | [{ where: Array<{ createdAt?: unknown; status: unknown; guestPayTokenHash?: unknown }> }]
      | undefined;
    expect(findCall?.[0].where).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: OrderStatus.PENDING_PAYMENT,
          createdAt: expect.anything(),
        }),
        expect.objectContaining({
          status: OrderStatus.PENDING_PAYMENT,
          guestPayTokenHash: expect.anything(),
        }),
      ]),
    );
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('cancels unpaid legacy guest orders with null guestPayTokenHash regardless of age', async () => {
    const legacyGuestOrder = {
      id: 'ord-legacy-guest',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - 60_000),
      guestPhone: '0812345678',
      guestPayTokenHash: null,
      paymentReference: null,
      items: [{ id: 'i1', fulfillmentStatus: 'pending' }],
    };
    const pendingPayment = {
      id: 'pay-legacy-1',
      orderId: 'ord-legacy-guest',
      status: 'pending',
      paymentMethod: 'promptpay',
    } as Payment;

    orderRepository.find.mockResolvedValue([legacyGuestOrder]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockResolvedValue([pendingPayment]);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(1);
    expect(legacyGuestOrder.status).toBe(OrderStatus.CANCELLED);
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-legacy-guest',
      expect.anything(),
      'Unpaid order expired',
    );
  });

  it('skips orders that already have a paid payment', async () => {
    const staleOrder = {
      id: 'ord-paid-edge',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    };
    orderRepository.find.mockResolvedValue([staleOrder]);
    paymentRepository.findOne.mockResolvedValue({
      id: 'pay-paid',
      orderId: 'ord-paid-edge',
      status: 'paid',
    });

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(0);
    expect(staleOrder.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
  });

  it('is idempotent when re-run finds no PENDING_PAYMENT candidates', async () => {
    orderRepository.find.mockResolvedValue([]);

    const first = await service.cancelStaleUnpaidOrders();
    const second = await service.cancelStaleUnpaidOrders();

    expect(first).toBe(0);
    expect(second).toBe(0);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('skips candidates that are no longer PENDING_PAYMENT (idempotent guard)', async () => {
    const candidate = {
      id: 'ord-already',
      status: OrderStatus.CANCELLED,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    };
    orderRepository.find.mockResolvedValue([candidate]);
    paymentRepository.findOne.mockResolvedValue(null);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(0);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
  });

  it('keeps QR finalizeExpiredPayment path callable without cancelling order (AC-020)', async () => {
    const createdAt = new Date(NOW.getTime() - 20 * 60 * 1000);
    const payment = {
      id: 'pay-qr-coexist',
      orderId: 'ord-qr-coexist',
      status: 'pending',
      paymentMethod: 'promptpay',
      psp: 'beam',
      pspChargeId: 'chrg_qr_coexist',
      createdAt,
      expiresAt: null,
    } as Payment;
    const order = {
      id: 'ord-qr-coexist',
      status: OrderStatus.PENDING_PAYMENT,
      paymentReference: 'chrg_qr_coexist',
    };
    orderRepository.findOne.mockResolvedValue(order);

    const updated = await service.expirePendingQrPaymentIfNeeded(payment);

    expect(updated.status).toBe('failed');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(order.paymentReference).toBeNull();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(typeof service.expirePendingQrPayments).toBe('function');
    expect(typeof service.cancelStaleUnpaidOrders).toBe('function');
  });

  it('24h cancel nulls paymentReference so late webhook cannot invent paid', async () => {
    const chargeId = 'chrg_24h_orphan';
    const staleOrder = {
      id: 'ord-24h-orphan',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      paymentReference: chargeId,
    };
    const pendingPayment = {
      id: 'pay-24h-orphan',
      orderId: 'ord-24h-orphan',
      status: 'pending',
      paymentMethod: 'credit_card',
    } as Payment;

    orderRepository.find.mockResolvedValue([staleOrder]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockResolvedValue([pendingPayment]);

    await service.cancelStaleUnpaidOrders();
    expect(staleOrder.status).toBe(OrderStatus.CANCELLED);
    expect(staleOrder.paymentReference).toBeNull();

    orderRepository.findOne.mockResolvedValue(null);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    paymentRepository.findOne.mockResolvedValue(null);

    await service.handleBeamWebhook({ chargeId });

    expect(warnSpy).toHaveBeenCalledWith(`No order/payment for Beam charge ${chargeId}`);
    expect(staleOrder.status).toBe(OrderStatus.CANCELLED);
    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('cancels stale order with only failed payments (abandoned card) and restores stock', async () => {
    const staleOrder = {
      id: 'ord-failed-only',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    };
    const failedPayment = {
      id: 'pay-failed',
      orderId: 'ord-failed-only',
      status: 'failed',
      paymentMethod: 'credit_card',
    } as Payment;

    orderRepository.find.mockResolvedValue([staleOrder]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockResolvedValue([failedPayment]);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(1);
    expect(staleOrder.status).toBe(OrderStatus.CANCELLED);
    expect(failedPayment.status).toBe('failed');
    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-failed-only',
      expect.anything(),
      'Unpaid order expired',
    );
  });

  it('reads unpaidOrderCancelAfterMs from payment config', async () => {
    orderRepository.find.mockResolvedValue([]);

    await service.cancelStaleUnpaidOrders(NOW);

    expect(configGet).toHaveBeenCalledWith('payment.unpaidOrderCancelAfterMs');
  });

  it('logs and continues the batch when one order cancel fails', async () => {
    const failingOrder = {
      id: 'ord-fail',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    };
    const okOrder = {
      id: 'ord-ok',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    };
    const okPayment = {
      id: 'pay-ok',
      orderId: 'ord-ok',
      status: 'pending',
      paymentMethod: 'credit_card',
    } as Payment;

    orderRepository.find.mockResolvedValue([failingOrder, okOrder]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockImplementation(({ where }: { where: { orderId: string } }) => {
      if (where.orderId === 'ord-ok') return Promise.resolve([okPayment]);
      return Promise.resolve([]);
    });
    paymentRepository.manager.transaction
      .mockRejectedValueOnce(new Error('tx failed'))
      .mockImplementation(async (cb: (manager: { save: jest.Mock }) => Promise<void>) => {
        await cb({ save: managerSave });
      });

    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(1);
    expect(okOrder.status).toBe(OrderStatus.CANCELLED);
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to cancel stale unpaid order ord-fail',
      expect.any(String),
    );
    errorSpy.mockRestore();
  });

  it('skips entire order when any item is on_hold (AC-040)', async () => {
    const heldOrder = {
      id: 'ord-held-skip',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      paymentReference: 'chrg_held',
      items: [
        { id: 'i-held', fulfillmentStatus: FulfillmentStatus.ON_HOLD },
        { id: 'i-sib', fulfillmentStatus: FulfillmentStatus.PENDING },
      ],
    };
    orderRepository.find.mockResolvedValue([heldOrder]);
    paymentRepository.findOne.mockResolvedValue(null);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(0);
    expect(heldOrder.status).toBe(OrderStatus.PENDING_PAYMENT);
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(paymentRepository.manager.transaction).not.toHaveBeenCalled();
  });

  it('still cancels non-held stale unpaid orders', async () => {
    const nonHeld = {
      id: 'ord-non-held',
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      paymentReference: null,
      items: [{ id: 'i1', fulfillmentStatus: FulfillmentStatus.PENDING }],
    };
    orderRepository.find.mockResolvedValue([nonHeld]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.find.mockResolvedValue([]);

    const cancelled = await service.cancelStaleUnpaidOrders();

    expect(cancelled).toBe(1);
    expect(nonHeld.status).toBe(OrderStatus.CANCELLED);
  });
});

describe('PaymentsService payment held gate + Decision #16 recompute (AC-026–027)', () => {
  let service: PaymentsService;
  const orderRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const paymentRepository = {
    create: jest.fn(<T>(x: T): T => x),
    save: jest.fn((x: Payment) => Promise.resolve({ ...x, id: 'pay-held-1' })),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    manager: {
      transaction: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const phaseBManager = createPhaseBManagerMock({ orderRepository, paymentRepository });
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (manager: unknown) => Promise<unknown>) => cb(phaseBManager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(Customer), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SavedPaymentMethod), useValue: { findOne: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: () => '',
          },
        },
        { provide: NotificationsService, useValue: { notifyOrderPaid: jest.fn() } },
        {
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: PaymentEventsService, useValue: paymentEventsServiceMock },
        { provide: InventoryService, useValue: { restoreOrderStock: jest.fn() } },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            isAvailable: jest.fn().mockReturnValue(true),
            get: jest.fn().mockResolvedValue({
              enabled: true,
              bankName: 'Test Bank',
              accountName: 'SOPET',
              accountNumber: '1234567890',
              branchName: null,
            }),
            update: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('blocks createCharge when all items on_hold with PAYMENT_HELD_PORTION_BLOCKED', async () => {
    const guestPay = guestPayFixture();
    const order = {
      id: 'ord-held-all',
      status: OrderStatus.PENDING_PAYMENT,
      customerId: null,
      guestPhone: '0812345678',
      guestPayTokenHash: guestPay.hash,
      guestPayTokenExpiresAt: guestPay.expiresAt,
      items: [
        { id: 'i1', fulfillmentStatus: FulfillmentStatus.ON_HOLD },
        { id: 'i2', fulfillmentStatus: FulfillmentStatus.ON_HOLD },
      ],
    };
    orderRepository.findOne.mockResolvedValue(order);

    await expect(
      service.createCharge({
        orderId: 'ord-held-all',
        amount: 100,
        currency: 'THB',
        paymentMethod: 'promptpay',
        guestPayToken: guestPay.plaintext,
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_HELD_PORTION_BLOCKED' } });
  });

  it('blocks createCharge when mixed unpaid has any on_hold item', async () => {
    const guestPay = guestPayFixture();
    const order = {
      id: 'ord-held-mixed',
      status: OrderStatus.PENDING_PAYMENT,
      customerId: null,
      guestPhone: '0812345678',
      guestPayTokenHash: guestPay.hash,
      guestPayTokenExpiresAt: guestPay.expiresAt,
      items: [
        { id: 'i1', fulfillmentStatus: FulfillmentStatus.ON_HOLD },
        { id: 'i2', fulfillmentStatus: FulfillmentStatus.PENDING },
      ],
    };
    orderRepository.findOne.mockResolvedValue(order);

    await expect(
      service.createCharge({
        orderId: 'ord-held-mixed',
        amount: 100,
        currency: 'THB',
        paymentMethod: 'cod',
        guestPayToken: guestPay.plaintext,
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_HELD_PORTION_BLOCKED' } });
  });

  it('allows createCharge after held lines cancelled and totals recomputed (Decision #16)', async () => {
    const { recomputeOrderPayableTotals } = await import('../orders/order-totals.util');
    const guestPay = guestPayFixture();
    const order = {
      id: 'ord-after-sla',
      status: OrderStatus.PENDING_PAYMENT,
      customerId: null,
      guestPhone: '0812345678',
      guestPayTokenHash: guestPay.hash,
      guestPayTokenExpiresAt: guestPay.expiresAt,
      subtotal: 300,
      shippingFee: 50,
      discountAmount: 0,
      total: 350,
      items: [
        {
          id: 'i-cancelled',
          storeId: 'store-a',
          fulfillmentStatus: FulfillmentStatus.CANCELLED,
          subtotal: 200,
          unitPrice: 200,
          quantity: 1,
        },
        {
          id: 'i-remain',
          storeId: 'store-b',
          fulfillmentStatus: FulfillmentStatus.PENDING,
          subtotal: 100,
          unitPrice: 100,
          quantity: 1,
        },
      ],
      storeShippings: [
        { storeId: 'store-a', shippingFee: 30 },
        { storeId: 'store-b', shippingFee: 20 },
      ],
    } as Order;

    recomputeOrderPayableTotals(order);
    expect(order.subtotal).toBe(100);
    expect(order.shippingFee).toBe(20);
    expect(order.total).toBe(120);

    orderRepository.findOne.mockResolvedValue(order);

    const result = await service.createCharge({
      orderId: 'ord-after-sla',
      amount: 120,
      currency: 'THB',
      paymentMethod: 'cod',
      guestPayToken: guestPay.plaintext,
    });

    expect(result.paymentMethod).toBe('cod');
    expect(result.status).toBe('pending');
  });
});

describe('buildPaymentReturnUri', () => {
  it('strips trailing slash on origin', () => {
    expect(buildPaymentReturnUri('https://shop.example.com/', 'pay-1')).toBe(
      'https://shop.example.com/payment/pay-1',
    );
  });

  it('throws when origin is empty after normalize', () => {
    expect(() => buildPaymentReturnUri('/', 'pay-1')).toThrow('STOREFRONT_URL_EMPTY');
    expect(() => buildPaymentReturnUri('', 'pay-1')).toThrow('STOREFRONT_URL_EMPTY');
  });
});

describe('PaymentsService handleBeamWebhook', () => {
  let service: PaymentsService;
  const CHARGE_ID = 'beam_chrg_wh_1';
  let order: Partial<Order>;
  let payment: Partial<Payment>;

  const orderRepository = { findOne: jest.fn(), save: jest.fn() };
  const paymentRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };
  const trx = { save: jest.fn((x: unknown) => Promise.resolve(x)) };

  beforeEach(async () => {
    jest.clearAllMocks();
    order = {
      id: 'ord-beam-1',
      status: OrderStatus.PENDING_PAYMENT,
      total: 300,
      paymentReference: CHARGE_ID,
    };
    payment = {
      id: 'pay-beam-1',
      orderId: 'ord-beam-1',
      status: 'pending',
      psp: 'beam',
      pspChargeId: CHARGE_ID,
    };
    paymentRepository.findOne.mockResolvedValue(payment);
    orderRepository.findOne.mockResolvedValue(order);
    paymentRepository.manager.transaction.mockImplementation(
      async (cb: (m: typeof trx) => Promise<unknown>) => cb(trx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(Customer), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SavedPaymentMethod), useValue: { findOne: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => '') } },
        { provide: NotificationsService, useValue: { notifyOrderPaid: jest.fn() } },
        {
          provide: DashboardEventsService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: PaymentEventsService, useValue: paymentEventsServiceMock },
        { provide: InventoryService, useValue: { restoreOrderStock: jest.fn() } },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: OrderAuditLogsService, useValue: orderAuditLogsServiceMock },
        { provide: BeamService, useValue: beamServiceMock },
        { provide: BankTransferSettingsService, useValue: {} },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  it('marks order paid on SUCCEEDED when amount matches', async () => {
    beamServiceMock.getCharge.mockResolvedValue({
      chargeId: CHARGE_ID,
      status: 'SUCCEEDED',
      amount: 30000,
    });

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(beamServiceMock.getCharge).toHaveBeenCalledWith(CHARGE_ID);
    expect(payment.status).toBe('paid');
    expect(order.status).toBe(OrderStatus.PAID);
  });

  it('does not mark paid when amount mismatches order total', async () => {
    beamServiceMock.getCharge.mockResolvedValue({
      chargeId: CHARGE_ID,
      status: 'SUCCEEDED',
      amount: 100,
    });

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(payment.status).toBe('pending');
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
  });

  it('fails payment on FAILED, clears paymentReference, keeps order PENDING_PAYMENT', async () => {
    beamServiceMock.getCharge.mockResolvedValue({ chargeId: CHARGE_ID, status: 'FAILED' });

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(payment.status).toBe('failed');
    expect(order.paymentReference).toBeNull();
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
  });

  it('is idempotent for already paid orders', async () => {
    order.status = OrderStatus.PAID;

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
  });

  it('ignores cancelled orders', async () => {
    order.status = OrderStatus.CANCELLED;

    await service.handleBeamWebhook({ chargeId: CHARGE_ID });

    expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
    expect(payment.status).toBe('pending');
  });

  it('falls back to order.paymentReference lookup', async () => {
    paymentRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(payment);
    beamServiceMock.getCharge.mockResolvedValue({
      chargeId: CHARGE_ID,
      status: 'SUCCEEDED',
      amount: 30000,
    });

    await service.handleBeamWebhook({ data: { chargeId: CHARGE_ID } });

    expect(orderRepository.findOne).toHaveBeenCalledWith({
      where: { paymentReference: CHARGE_ID },
    });
    expect(order.status).toBe(OrderStatus.PAID);
  });
});
