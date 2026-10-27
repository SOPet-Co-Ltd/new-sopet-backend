// Unpaid Order Payment Method Switch [integration] Test
// Design Doc: unpaid-order-payment-method-switch-backend-design.md
// Frontend Design Doc: unpaid-order-payment-method-switch-frontend-design.md (consumer contracts)
// UI Spec: unpaid-order-payment-method-switch-ui-spec.md | PRD: unpaid-order-payment-method-switch-prd.md
// Generated: 2026-07-19 | Budget Used (feature): integration 3/3 (this file), fixture-e2e 3/3 (storefront), service-e2e 2/2 (see unpaid-order-payment-method-switch.service.e2e.test.ts)
//
// Run:
//   yarn jest --config ./test/jest-e2e.json --testRegex='unpaid-order-payment-method-switch.int.test.ts$' --no-coverage
//
// Covers (priority ACs):
//   Always-new paymentId (PromptPay restart)
//   ORDER_NOT_PAYABLE eligibility (incl. COD)
//   order.paymentMethod sync + payments.psp_charge_id
//   COD clears order.paymentReference + orphan Beam webhook residual
//
// Harness: Nest TestingModule + PaymentsService; mocked TypeORM repos; mocked BeamService
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: BeamService (createCharge / getCharge)
// Mock: TypeORM Payment/Order repositories (existing payments.service.spec pattern)
// Mock: InventoryService (assert NOT called on supersede; only on finalize/24h — 24h in service-e2e)
// @real-dependency: PaymentsService.createCharge / handleBeamWebhook logic
//
// Dedup / push-down notes:
//   Unit suite (payments.service.spec.ts) covers finer grain path cases; this lane owns INT matrix
//   proof obligations (always-new+sync, three fail-open classes, eligibility/COD/orphan).

import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { Payment } from '../src/database/entities/payment.entity';
import { Order, OrderStatus } from '../src/database/entities/order.entity';
import { Customer } from '../src/database/entities/customer.entity';
import { SavedPaymentMethod } from '../src/database/entities/saved-payment-method.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PaymentEventsService } from '../src/modules/payments/payment-events.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { VendorWebhooksService } from '../src/modules/vendor-webhooks/vendor-webhooks.service';
import { BankTransferSettingsService } from '../src/modules/platform/bank-transfer-settings.service';
import { OrderAuditLogsService } from '../src/modules/order-audit-logs/order-audit-logs.service';
import { BeamService } from '../src/modules/beam/beam.service';

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

/** EntityManager mock for Phase B FOR UPDATE createCharge path (mirrors unit harness). */
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

describe('unpaid-order-payment-method-switch integration', () => {
  const STOREFRONT_ORIGIN = 'https://shop.example.com';
  const PRIOR_PAYMENT_ID = 'pay-prior-pending';
  const NEW_PAYMENT_ID = 'pay-new-after-supersede';
  const OLD_CHARGE_ID = 'chrg_old_superseded';
  const NEW_CHARGE_ID = 'chrg_new_active';

  const order = {
    id: 'ord-int-switch-1',
    customerId: 'cust-1',
    total: 300,
    status: OrderStatus.PENDING_PAYMENT,
    paymentReference: OLD_CHARGE_ID as string | null,
    paymentMethod: undefined as string | undefined,
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

  let service: PaymentsService;
  let inventoryService: { restoreOrderStock: jest.Mock };

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
          provide: PaymentEventsService,
          useValue: paymentEventsServiceMock,
        },
        {
          provide: InventoryService,
          useValue: inventoryService,
        },
        { provide: BeamService, useValue: beamServiceMock },
        { provide: PayoutsService, useValue: payoutsServiceMock },
        { provide: StoresService, useValue: storesServiceMock },
        {
          provide: VendorWebhooksService,
          useValue: { dispatchOrderEvent: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OrderAuditLogsService,
          useValue: {
            append: jest.fn().mockResolvedValue(undefined),
            resolveCustomerActorLabel: jest.fn().mockResolvedValue('ลูกค้า'),
          },
        },
        {
          provide: BankTransferSettingsService,
          useValue: {
            getConfigured: jest.fn().mockResolvedValue(null),
            isAvailable: jest.fn().mockReturnValue(false),
            get: jest.fn().mockResolvedValue({
              enabled: false,
              bankName: '',
              accountName: '',
              accountNumber: '',
              branchName: null,
            }),
          },
        },
      ],
    }).compile();

    return module.get(PaymentsService);
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

  function mockSuccessfulBeamCharge() {
    beamServiceMock.hasCredentials.mockReturnValue(true);
    beamServiceMock.createCharge.mockResolvedValue({
      chargeId: NEW_CHARGE_ID,
      status: 'PENDING',
      encodedImage: { imageBase64Encoded: 'data:image/png;base64,AAAA' },
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    order.status = OrderStatus.PENDING_PAYMENT;
    order.paymentReference = OLD_CHARGE_ID;
    order.paymentMethod = undefined;
    orderRepository.findOne.mockResolvedValue(order);
    orderRepository.save.mockImplementation((o: typeof order) => Promise.resolve(o));
    paymentRepository.find.mockResolvedValue([]);
    paymentRepository.findOne.mockResolvedValue(null);
    paymentRepository.create.mockImplementation(<T>(x: T): T => x);
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
    mockSuccessfulBeamCharge();
    service = await compileService();
  });

  // -------------------------------------------------------------------------
  // INT-1 — Always-new PromptPay restart + field sync
  // -------------------------------------------------------------------------
  //
  // AC: "When eligible and client requests PromptPay again while a prior PromptPay payment
  // is still pending, then the system shall create a new Payment row and return a new
  // paymentId (not soft-resume); persist psp_charge_id; sync order.paymentMethod"
  // @category: core-functionality
  // @lane: integration
  // @dependency: PaymentsService.createCharge (real); BeamService + Payment/Order repos +
  // InventoryService (mock)
  // Verification points:
  //   - result.paymentId === NEW and !== PRIOR; prior.status === 'failed'
  //   - BeamService.createCharge invoked
  //   - saved payment.pspChargeId + order.paymentReference/method synced; no stock restore
  //
  describe('INT-1 always-new PromptPay restart + field sync', () => {
    it('PromptPay pending restart → new paymentId, sync fields, no stock restore', async () => {
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
      expect(paymentEventsServiceMock.publishPaymentStatusUpdated).toHaveBeenCalledWith(prior);

      expect(beamServiceMock.createCharge).toHaveBeenCalledTimes(1);

      const savedPayments = paymentRepository.save.mock.calls.map((c: [Payment]) => c[0]);
      const created = savedPayments.find((p) => p.id === NEW_PAYMENT_ID);
      expect(created?.pspChargeId).toBe(NEW_CHARGE_ID);
      expect(order.paymentReference).toBe(NEW_CHARGE_ID);
      expect(order.paymentMethod).toBe('promptpay');
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // INT-3 — ORDER_NOT_PAYABLE + card→COD clear + orphan Beam webhook
  // -------------------------------------------------------------------------
  //
  // AC: "If order is not pending_payment or the latest payment is paid/refunded, then reject
  // with ORDER_NOT_PAYABLE including COD; when new payment is COD after an online method, null
  // order.paymentReference; unmatched orphan webhook warn+return and never invent paid"
  // @category: core-functionality
  // @lane: integration
  // @dependency: PaymentsService.createCharge / handleBeamWebhook (real)
  // Verification points:
  //   - PAID / paid-latest → COD + PromptPay both ORDER_NOT_PAYABLE; create not called
  //   - Online→COD → paymentReference null; method cod; pspChargeId absent; no stock restore
  //   - Orphan webhook → warn; status PENDING_PAYMENT; no save / paid publish / Beam GET
  //
  describe('INT-3 eligibility + COD clear + orphan webhook', () => {
    it('rejects COD and PromptPay with ORDER_NOT_PAYABLE when latest payment is paid', async () => {
      const paidLatest = {
        id: 'pay-paid-latest',
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

      await expect(
        service.createCharge({
          orderId: order.id,
          amount: 300,
          currency: 'THB',
          paymentMethod: 'promptpay',
          customerId: 'cust-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

      expect(paymentRepository.create).not.toHaveBeenCalled();
    });

    it('rejects COD and PromptPay with ORDER_NOT_PAYABLE when order is PAID', async () => {
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

      await expect(
        service.createCharge({
          orderId: order.id,
          amount: 300,
          currency: 'THB',
          paymentMethod: 'promptpay',
          customerId: 'cust-1',
        }),
      ).rejects.toMatchObject({ response: { code: 'ORDER_NOT_PAYABLE' } });

      expect(paymentRepository.create).not.toHaveBeenCalled();
    });

    it('PromptPay→COD clears paymentReference, syncs method; orphan webhook never invents paid', async () => {
      const prior = priorPromptPayPending();
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

      // Isolate invent-paid side effects from the prior createCharge path.
      orderRepository.save.mockClear();
      paymentRepository.save.mockClear();
      paymentEventsServiceMock.publishPaymentStatusUpdated.mockClear();
      inventoryService.restoreOrderStock.mockClear();

      orderRepository.findOne.mockResolvedValue(null);
      paymentRepository.findOne.mockResolvedValue(null);
      beamServiceMock.getCharge.mockClear();
      const warnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
        'warn',
      );
      await service.handleBeamWebhook({ chargeId: OLD_CHARGE_ID, status: 'SUCCEEDED' });

      expect(warnSpy).toHaveBeenCalledWith(`No order/payment for Beam charge ${OLD_CHARGE_ID}`);
      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(orderRepository.save).not.toHaveBeenCalled();
      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(paymentEventsServiceMock.publishPaymentStatusUpdated).not.toHaveBeenCalled();
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
      expect(beamServiceMock.getCharge).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
