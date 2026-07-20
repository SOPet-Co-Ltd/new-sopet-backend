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
//   Always-new paymentId (PromptPay restart) + cancel-before-create attempt
//   Fail-open cancel still creates
//   ORDER_NOT_PAYABLE eligibility (incl. COD)
//   order.paymentMethod sync + payments.omise_charge_id
//   COD clears order.paymentReference + orphan webhook residual
//
// Harness: Nest TestingModule + PaymentsService; mocked TypeORM repos; mocked global.fetch (Omise)
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Omise HTTP (fetch) — expire/timeout/create matrix
// Mock: TypeORM Payment/Order repositories (existing payments.service.spec pattern)
// Mock: InventoryService (assert NOT called on supersede; only on finalize/24h — 24h in service-e2e)
// Mock: Clock — not required in this file (24h job is service-e2e)
// @real-dependency: PaymentsService.createCharge / cancelOmiseChargeBestEffort / handleWebhook logic
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

const paymentEventsServiceMock = {
  publishPaymentStatusUpdated: jest.fn(),
};

const payoutsServiceMock = {
  handleOmiseTransferWebhook: jest.fn(),
};

const storesServiceMock = {
  handleOmiseRecipientWebhook: jest.fn(),
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

function fetchPaths(): string[] {
  return (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
}

function isChargeCreateUrl(url: string): boolean {
  return url.includes('/charges') && !url.includes('/expire') && !url.includes('/reverse');
}

describe('unpaid-order-payment-method-switch integration', () => {
  const STOREFRONT_ORIGIN = 'https://shop.example.com';
  const PRIOR_PAYMENT_ID = 'pay-prior-pending';
  const NEW_PAYMENT_ID = 'pay-new-after-supersede';
  const OLD_CHARGE_ID = 'chrg_old_superseded';
  const NEW_CHARGE_ID = 'chrg_new_active';
  const OMISE_CANCEL_TIMEOUT_MS = 50;

  const order = {
    id: 'ord-int-switch-1',
    customerId: 'cust-1',
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
              if (key === 'omise.secretKey') return 'skey_test';
              if (key === 'omise.publicKey') return 'pkey_test';
              if (key === 'app.storefrontUrl') return STOREFRONT_ORIGIN;
              if (key === 'payment.qrExpiryMinutes') return 15;
              if (key === 'payment.omiseCancelTimeoutMs') return OMISE_CANCEL_TIMEOUT_MS;
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

  function priorPromptPayPending(): Payment {
    return {
      id: PRIOR_PAYMENT_ID,
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'pending',
      paymentMethod: 'promptpay',
      omiseChargeId: OLD_CHARGE_ID,
      qrCodeUrl: 'https://api.omise.co/qr/old',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    } as Payment;
  }

  function priorCardPending(): Payment {
    return {
      id: PRIOR_PAYMENT_ID,
      orderId: order.id,
      amount: 300,
      currency: 'THB',
      status: 'pending',
      paymentMethod: 'credit_card',
      omiseChargeId: OLD_CHARGE_ID,
      authorizeUri: 'https://pay.omise.co/old',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
    } as Payment;
  }

  function mockSuccessfulOmiseFetch() {
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
            source: { scannable_code: { image: { download_uri: 'https://api.omise.co/qr/new' } } },
          }),
      });
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
    mockSuccessfulOmiseFetch();
    service = await compileService();
  });

  // -------------------------------------------------------------------------
  // INT-1 — Always-new PromptPay restart + cancel attempt + field sync
  // -------------------------------------------------------------------------
  //
  // AC: "When eligible and client requests PromptPay again while a prior PromptPay payment
  // is still pending, then the system shall create a new Payment row and return a new
  // paymentId (not soft-resume); cancel Omise first best-effort; persist omise_charge_id;
  // sync order.paymentMethod" (prd AC-003–AC-008, AC-012, AC-014–AC-015)
  // ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
  // Behavior: Prior PromptPay pending + createCharge PromptPay → cancel expire attempt →
  // new paymentId ≠ prior; prior.status failed; omise_charge_id + order.paymentMethod sync;
  // restoreOrderStock not called
  // @category: core-functionality
  // @lane: integration
  // @dependency: PaymentsService.createCharge / cancelOmiseChargeBestEffort (real);
  // Omise fetch + Payment/Order repos + InventoryService (mock)
  // @complexity: high
  // Primary failure mode: PromptPay soft-resume returns same paymentId; cancel never
  // attempted; omise_charge_id not written; order.paymentMethod stale after switch
  // Proof obligation: Fixture prior PromptPay pending with omiseChargeId (or single-pending
  // + order.paymentReference); mock fetch expire 2xx then create charge with new id; call
  // createCharge PromptPay again; assert result.paymentId !== prior.id; prior.status ===
  // 'failed'; fetch URLs include /charges/{oldId}/expire (or documented cleanup path) AND
  // a new POST /charges; saved payment.omiseChargeId === new charge id; order.paymentMethod
  // === 'promptpay'; inventoryService.restoreOrderStock not called. Boundary path: mid-QR
  // same-method restart must not take soft-resume early-return (invert payments.service.spec
  // “PromptPay pending resume”). Mock only Omise HTTP + repos; exercise real createCharge
  // supersede path.
  // Verification points / expected results / pass criteria:
  //   - result.paymentId === NEW and !== PRIOR; prior.status === 'failed'
  //   - fetch includes /expire on old charge AND new POST /charges
  //   - saved payment.omiseChargeId + order.paymentReference/method synced; no stock restore
  //
  describe('INT-1 always-new PromptPay restart + cancel + field sync', () => {
    it('PromptPay pending restart → new paymentId, expire attempt, sync fields, no stock restore', async () => {
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

      const paths = fetchPaths();
      expect(paths.some((p) => p.includes(`/charges/${OLD_CHARGE_ID}/expire`))).toBe(true);
      expect(paths.some(isChargeCreateUrl)).toBe(true);

      const savedPayments = paymentRepository.save.mock.calls.map((c: [Payment]) => c[0]);
      const created = savedPayments.find((p) => p.id === NEW_PAYMENT_ID);
      expect(created?.omiseChargeId).toBe(NEW_CHARGE_ID);
      expect(order.paymentReference).toBe(NEW_CHARGE_ID);
      expect(order.paymentMethod).toBe('promptpay');
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // INT-2 — Fail-open cancel classes still create + AC-022 warn fields
  // -------------------------------------------------------------------------
  //
  // AC: "If Omise cleanup fails, is unsupported, or exceeds the cancel budget, then the
  // system shall still local-supersede, create the new payment/charge, and emit ops
  // warn/alert with order id, prior payment id, and prior charge id" (prd AC-010, AC-011,
  // AC-022)
  // ROI: 98 (BV:10 × Freq:8 + Legal:0 + Defect:10)
  // Behavior: Three cancel-failure classes (HTTP 4xx unsupported, network throw, AbortSignal
  // timeout) each still yield successful createCharge + new paymentId; logger.warn includes
  // omise_cancel_fail_open + orderId + prior paymentId + prior charge id
  // @category: core-functionality
  // @lane: integration
  // @dependency: PaymentsService.createCharge / cancelOmiseChargeBestEffort (real);
  // Omise fetch failure matrix + Payment/Order repos (mock)
  // @complexity: high
  // Primary failure mode: cancel failure hard-blocks createCharge for the customer; or
  // fail-open creates without ops warn (orphan undetectable)
  // Proof obligation: Three cancel-failure classes (HTTP 4xx unsupported, network throw,
  // timeout past omiseCancelTimeoutMs/4000ms) each still yield successful create + new
  // paymentId; assert logger.warn / structured alert includes orderId + prior paymentId +
  // prior charge id; assert createCharge does not throw BadRequest solely due to cancel
  // failure. Boundary path: card expire/reverse unsupported is primary fail-open (I004) —
  // treat unsupported as success path for customer create, not product defect.
  // Verification points / expected results / pass criteria:
  //   - Each of 4xx / throw / timeout → result.paymentId === NEW; prior failed
  //   - warn contains omise_cancel_fail_open + orderId + PRIOR_PAYMENT_ID + OLD_CHARGE_ID
  //   - create charge path still invoked (POST /charges present)
  //
  describe('INT-2 fail-open cancel still creates', () => {
    async function assertFailOpenCreate(opts: {
      prior: Payment;
      paymentMethod: 'promptpay' | 'credit_card';
      omiseToken?: string;
    }) {
      paymentRepository.findOne.mockResolvedValue(opts.prior);
      paymentRepository.find.mockResolvedValue([opts.prior]);

      const warnSpy = jest.spyOn(
        (service as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger,
        'warn',
      );

      const result = await service.createCharge({
        orderId: order.id,
        amount: 300,
        currency: 'THB',
        paymentMethod: opts.paymentMethod,
        omiseToken: opts.omiseToken,
        customerId: 'cust-1',
      });

      expect(result.paymentId).toBe(NEW_PAYMENT_ID);
      expect(result.paymentId).not.toBe(PRIOR_PAYMENT_ID);
      expect(opts.prior.status).toBe('failed');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('omise_cancel_fail_open'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(order.id));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(PRIOR_PAYMENT_ID));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(OLD_CHARGE_ID));
      warnSpy.mockRestore();
      return result;
    }

    it('HTTP 4xx unsupported expire still creates + warns (AC-022)', async () => {
      const prior = priorCardPending();
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && (url.includes('/expire') || url.includes('/reverse'))) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ message: 'expire unsupported' }),
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

      await assertFailOpenCreate({
        prior,
        paymentMethod: 'credit_card',
        omiseToken: 'tokn_new_1',
      });
      expect(fetchPaths().some(isChargeCreateUrl)).toBe(true);
    });

    it('network throw on expire still creates + warns', async () => {
      const prior = priorPromptPayPending();
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/expire')) {
          return Promise.reject(new Error('ECONNRESET'));
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

      await assertFailOpenCreate({ prior, paymentMethod: 'promptpay' });
      expect(fetchPaths().some(isChargeCreateUrl)).toBe(true);
    });

    it('cancel timeout (AbortSignal) still creates + warns', async () => {
      const prior = priorPromptPayPending();
      global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (typeof url === 'string' && url.includes('/expire')) {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              if (signal.aborted) {
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                return;
              }
              signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
              });
            }
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

      await assertFailOpenCreate({ prior, paymentMethod: 'promptpay' });
      expect(fetchPaths().some(isChargeCreateUrl)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // INT-3 — ORDER_NOT_PAYABLE + Omise→COD clear + orphan webhook
  // -------------------------------------------------------------------------
  //
  // AC: "If order is not pending_payment or the latest payment is paid/refunded, then reject
  // with ORDER_NOT_PAYABLE including COD; when new payment is COD after Omise, null
  // order.paymentReference; unmatched orphan webhook warn+return and never invent paid"
  // (prd AC-001–AC-002; COD clear; webhook residual)
  // ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
  // Behavior: (1) PAID order / paid latest → COD and PromptPay both ORDER_NOT_PAYABLE, no
  // new row; (2) Omise→COD clears paymentReference + syncs method; (3) orphan
  // charge.complete for prior chrg_… → warn+return, no invent-paid side effects
  // @category: core-functionality
  // @lane: integration
  // @dependency: PaymentsService.createCharge / handleWebhook (real); Payment/Order repos +
  // InventoryService + PaymentEventsService (mock)
  // @complexity: high
  // Primary failure mode: COD skips eligibility (BE-UPMS-008 hole); Omise→COD leaves stale
  // paymentReference so orphan webhook invents paid
  // Proof obligation: (1) order status PAID or latest payment paid → createCharge with COD
  // and with PromptPay both throw BadRequestException({ code: 'ORDER_NOT_PAYABLE' });
  // paymentRepository.create not used for a new row. (2) pending PromptPay with charge id →
  // createCharge COD → prior failed; order.paymentReference === null; order.paymentMethod
  // === 'cod'; payment.omiseChargeId absent/null. (3) handleWebhook charge.complete for prior
  // chrg_… with paymentReference already null → warn + return; order.status remains
  // PENDING_PAYMENT; no orderRepository.save / paid-event invent-paid side effects. Boundary
  // path: COD branch must share eligibility gate with Omise (hoist before COD early path).
  // Verification points / expected results / pass criteria:
  //   - PAID / paid-latest → COD + PromptPay both ORDER_NOT_PAYABLE; create not called
  //   - Omise→COD → paymentReference null; method cod; omiseChargeId null; no stock restore
  //   - Orphan webhook → warn; status PENDING_PAYMENT; no save / paid publish / Omise GET
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

    it('Omise→COD clears paymentReference, syncs method; orphan webhook never invents paid', async () => {
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
      expect(created?.omiseChargeId ?? null).toBeNull();
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();

      // Isolate invent-paid side effects from the prior createCharge path.
      orderRepository.save.mockClear();
      paymentRepository.save.mockClear();
      paymentEventsServiceMock.publishPaymentStatusUpdated.mockClear();
      inventoryService.restoreOrderStock.mockClear();

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
      expect(orderRepository.save).not.toHaveBeenCalled();
      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(paymentEventsServiceMock.publishPaymentStatusUpdated).not.toHaveBeenCalled();
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
