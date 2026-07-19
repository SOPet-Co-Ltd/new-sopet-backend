// Unpaid Order Payment Method Switch [service-integration-e2e]
// Promoted from test/unpaid-order-payment-method-switch.service.e2e.test.ts (Q.1)
// Design Doc: unpaid-order-payment-method-switch-backend-design.md
// PRD: unpaid-order-payment-method-switch-prd.md | ADR-0006
//
// Run (requires local Postgres — `yarn docker:up`):
//   yarn test:e2e --testPathPattern=unpaid-order-payment-method-switch.service.e2e-spec.ts
//
// @real-dependency: PostgreSQL (orders, payments, inventory stock restore)
// @real-dependency: GraphQL createPayment → PaymentsResolver → createCharge
// Mock: Omise HTTP (global.fetch) — never live Omise in CI
// Mock: Clock via cancelStaleUnpaidOrders(now) for 24h eligibility
//
// Journey 1: GraphQL createPayment supersede persists new payment + field sync
// Journey 2: 24h unpaid auto-cancel + stock restore; paid/young skip; idempotent; QR coexistence

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { PaymentsResolver } from '../src/modules/payments/payments.resolver';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PaymentEventsService } from '../src/modules/payments/payment-events.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { Payment } from '../src/database/entities/payment.entity';
import { Order, OrderStatus, PaymentMethod } from '../src/database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../src/database/entities/order-item.entity';
import { Customer } from '../src/database/entities/customer.entity';
import { SavedPaymentMethod } from '../src/database/entities/saved-payment-method.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { Store, StoreStatus } from '../src/database/entities/store.entity';
import { UserRole } from '../src/database/entities/user.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../src/database/entities/inventory-transaction.entity';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestUser,
  isPostgresAvailable,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

const CREATE_PAYMENT_MUTATION = `
  mutation CreatePayment($input: CreatePaymentInput!) {
    createPayment(input: $input) {
      id
      orderId
      amount
      currency
      status
      paymentMethod
      qrCodeUrl
      expiresAt
    }
  }
`;

const AMOUNT = 300;
const OLD_CHARGE_ID = 'chrg_e2e_old_superseded';
const NEW_CHARGE_ID = 'chrg_e2e_new_active';
const NOW = new Date('2026-07-20T00:00:00.000Z');
const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('Unpaid order payment method switch (service-integration-e2e)', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let paymentsService: PaymentsService;
  let orderRepo: Repository<Order>;
  let paymentRepo: Repository<Payment>;
  let orderItemRepo: Repository<OrderItem>;
  let variantRepo: Repository<ProductVariant>;
  let inventoryTxnRepo: Repository<InventoryTransaction>;

  const seedContext = createSeedRunContext(`unpaid-switch-${Date.now()}`);
  const tracked = {
    orderIds: [] as string[],
    paymentIds: [] as string[],
    variantIds: [] as string[],
  };

  const originalFetch = global.fetch;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      throw new Error(
        'PostgreSQL not available for unpaid-order-payment-method-switch service-e2e. ' +
          'Run `yarn docker:up` and ensure DB_NAME=sopet_ecommerce accepts connections. ' +
          'Do not fake-green this suite.',
      );
    }

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([
          Payment,
          Order,
          OrderItem,
          Customer,
          SavedPaymentMethod,
          ProductVariant,
          Product,
          Store,
          InventoryTransaction,
        ]),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        }),
      ],
      providers: [
        PaymentsResolver,
        PaymentsService,
        PaymentEventsService,
        InventoryService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'omise.secretKey') return 'skey_test_e2e';
              if (key === 'omise.publicKey') return 'pkey_test_e2e';
              if (key === 'app.storefrontUrl') return 'https://shop.example.com';
              if (key === 'payment.qrExpiryMinutes') return 15;
              if (key === 'payment.omiseCancelTimeoutMs') return 200;
              if (key === 'payment.unpaidOrderCancelAfterMs') return 86_400_000;
              return undefined;
            },
          },
        },
        {
          provide: NotificationsService,
          useValue: { notifyOrderPaid: jest.fn() },
        },
        {
          provide: PayoutsService,
          useValue: { handleOmiseTransferWebhook: jest.fn() },
        },
        {
          provide: StoresService,
          useValue: { handleOmiseRecipientWebhook: jest.fn() },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    paymentsService = moduleFixture.get(PaymentsService);
    orderRepo = moduleFixture.get(getRepositoryToken(Order));
    paymentRepo = moduleFixture.get(getRepositoryToken(Payment));
    orderItemRepo = moduleFixture.get(getRepositoryToken(OrderItem));
    variantRepo = moduleFixture.get(getRepositoryToken(ProductVariant));
    inventoryTxnRepo = moduleFixture.get(getRepositoryToken(InventoryTransaction));
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (dataSource?.isInitialized) {
      await cleanupTracked();
      await cleanupSeedRun(dataSource, seedContext);
    }
    if (app) {
      await app.close();
    }
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  async function cleanupTracked(): Promise<void> {
    if (tracked.orderIds.length) {
      await dataSource.query(
        `DELETE FROM inventory_transactions WHERE reference_id = ANY($1::uuid[])`,
        [tracked.orderIds],
      );
      await dataSource.query(`DELETE FROM payments WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await dataSource.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await orderRepo.delete(tracked.orderIds);
    }
    if (tracked.variantIds.length) {
      await variantRepo.delete(tracked.variantIds);
    }
    tracked.orderIds = [];
    tracked.paymentIds = [];
    tracked.variantIds = [];
  }

  function stubOmiseFetch(opts: { expireOk?: boolean; newChargeId?: string } = {}): void {
    const expireOk = opts.expireOk ?? true;
    const newChargeId = opts.newChargeId ?? NEW_CHARGE_ID;
    let createCount = 0;

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && (url.includes('/expire') || url.includes('/reverse'))) {
        if (!expireOk) {
          return Promise.resolve({
            ok: false,
            json: () =>
              Promise.resolve({
                object: 'error',
                code: 'failed_expire',
                message: 'cannot expire',
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: OLD_CHARGE_ID, status: 'expired' }),
        });
      }

      if (typeof url === 'string' && url.includes('/charges') && !url.includes('/expire')) {
        createCount += 1;
        const chargeId = createCount === 1 ? newChargeId : `${newChargeId}_${createCount}`;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: chargeId,
              status: 'pending',
              source: {
                scannable_code: {
                  image: { download_uri: `https://api.omise.co/qr/${chargeId}` },
                },
              },
            }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 'unused', status: 'pending' }),
      });
    }) as typeof fetch;
  }

  async function seedCatalog(label: string): Promise<{
    store: Store;
    product: Product;
    variant: ProductVariant;
  }> {
    const owner = await createTestUser(dataSource, seedContext, {
      suffix: `owner-${label}`,
      role: UserRole.VENDOR,
    });
    const store = await createTestStore(dataSource, seedContext, {
      suffix: `store-${label}`,
      ownerId: owner.id,
      status: StoreStatus.APPROVED,
      approvedBy: owner.id,
    });
    const product = await createTestProduct(dataSource, seedContext, {
      suffix: `product-${label}`,
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `UnpaidSwitch Product ${label}`,
    });
    const variant = await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: `SKU-USW-${label}-${seedContext.runId}`.slice(0, 100),
        options: { size: 'default' },
        priceAdjustment: 0,
        stockQuantity: 10,
      }),
    );
    tracked.variantIds.push(variant.id);
    return { store, product, variant };
  }

  async function seedGuestOrder(input: {
    label: string;
    status: OrderStatus;
    paymentMethod: PaymentMethod;
    paymentReference: string | null;
    createdAt?: Date;
    store: Store;
    product: Product;
    variant: ProductVariant;
    quantity?: number;
    reserveStock?: boolean;
  }): Promise<{ order: Order; item: OrderItem }> {
    const quantity = input.quantity ?? 2;
    const orderNumber = `E2E-USW-${input.label}-${seedContext.runId}`.slice(0, 50);

    const order = await orderRepo.save(
      orderRepo.create({
        orderNumber,
        customerId: null,
        guestPhone: '+66812345678',
        guestName: `Guest ${input.label}`,
        status: input.status,
        subtotal: AMOUNT,
        discountAmount: 0,
        shippingFee: 0,
        total: AMOUNT,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference,
        paidAt: input.status === OrderStatus.PAID ? new Date() : null,
      }),
    );
    tracked.orderIds.push(order.id);

    if (input.createdAt) {
      await dataSource.query(`UPDATE orders SET created_at = $1, updated_at = $1 WHERE id = $2`, [
        input.createdAt,
        order.id,
      ]);
      order.createdAt = input.createdAt;
    }

    if (input.reserveStock) {
      const reservedStock = Math.max(0, input.variant.stockQuantity - quantity);
      await variantRepo.update(input.variant.id, { stockQuantity: reservedStock });
      input.variant.stockQuantity = reservedStock;
    }

    const item = await orderItemRepo.save(
      orderItemRepo.create({
        orderId: order.id,
        storeId: input.store.id,
        variantId: input.variant.id,
        productName: input.product.name,
        variantOptions: { size: 'default' },
        unitPrice: AMOUNT / quantity,
        quantity,
        subtotal: AMOUNT,
        fulfillmentStatus: FulfillmentStatus.PENDING,
      }),
    );

    return { order, item };
  }

  async function seedPayment(input: {
    orderId: string;
    status: Payment['status'];
    paymentMethod: PaymentMethod;
    omiseChargeId: string | null;
    expiresAt?: Date | null;
    createdAt?: Date;
  }): Promise<Payment> {
    const payment = await paymentRepo.save(
      paymentRepo.create({
        orderId: input.orderId,
        amount: AMOUNT,
        currency: 'THB',
        paymentMethod: input.paymentMethod,
        status: input.status,
        omiseChargeId: input.omiseChargeId,
        qrCodeUrl:
          input.paymentMethod === PaymentMethod.PROMPTPAY
            ? `https://api.omise.co/qr/${input.omiseChargeId ?? 'none'}`
            : null,
        expiresAt: input.expiresAt ?? null,
        authorizeUri: null,
      }),
    );
    tracked.paymentIds.push(payment.id);

    if (input.createdAt) {
      await dataSource.query(`UPDATE payments SET created_at = $1, updated_at = $1 WHERE id = $2`, [
        input.createdAt,
        payment.id,
      ]);
      payment.createdAt = input.createdAt;
    }

    return payment;
  }

  // ---------------------------------------------------------------------------
  // Journey 1 — GraphQL createPayment supersede persists
  // ---------------------------------------------------------------------------
  it('Journey 1: GraphQL createPayment supersede persists new payment + field sync', async () => {
    stubOmiseFetch({ expireOk: true, newChargeId: NEW_CHARGE_ID });

    const catalog = await seedCatalog('j1');
    const { order } = await seedGuestOrder({
      label: 'j1-supersede',
      status: OrderStatus.PENDING_PAYMENT,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paymentReference: OLD_CHARGE_ID,
      store: catalog.store,
      product: catalog.product,
      variant: catalog.variant,
    });
    const prior = await seedPayment({
      orderId: order.id,
      status: 'pending',
      paymentMethod: PaymentMethod.PROMPTPAY,
      omiseChargeId: OLD_CHARGE_ID,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const res = await request(app!.getHttpServer() as App)
      .post('/graphql')
      .send({
        query: CREATE_PAYMENT_MUTATION,
        variables: {
          input: {
            orderId: order.id,
            amount: AMOUNT,
            currency: 'THB',
            paymentMethod: 'promptpay',
          },
        },
      })
      .expect(200);

    const body = res.body as {
      data?: { createPayment?: { id: string; paymentMethod: string; status: string } };
      errors?: Array<{ message: string }>;
    };

    expect(body.errors).toBeUndefined();
    expect(body.data?.createPayment).toBeDefined();
    const gqlPayment = body.data!.createPayment!;
    expect(gqlPayment.id).not.toBe(prior.id);
    expect(gqlPayment.paymentMethod).toBe(PaymentMethod.PROMPTPAY);
    expect(gqlPayment.status).toBe('pending');

    const priorDb = await paymentRepo.findOneByOrFail({ id: prior.id });
    expect(priorDb.status).toBe('failed');

    const newDb = await paymentRepo.findOneByOrFail({ id: gqlPayment.id });
    expect(newDb.omiseChargeId).toBe(NEW_CHARGE_ID);
    expect(newDb.status).toBe('pending');
    expect(newDb.paymentMethod).toBe(PaymentMethod.PROMPTPAY);

    const orderDb = await orderRepo.findOneByOrFail({ id: order.id });
    expect(orderDb.paymentMethod).toBe(PaymentMethod.PROMPTPAY);
    expect(orderDb.paymentReference).toBe(NEW_CHARGE_ID);
    expect(orderDb.status).toBe(OrderStatus.PENDING_PAYMENT);

    const pendingForOrder = await paymentRepo.find({
      where: { orderId: order.id, status: 'pending' },
    });
    expect(pendingForOrder).toHaveLength(1);
    expect(pendingForOrder[0].id).toBe(gqlPayment.id);

    const fetchUrls = (global.fetch as jest.Mock).mock.calls.map((c: [string]) => c[0]);
    expect(fetchUrls.some((u: string) => u.includes(`/charges/${OLD_CHARGE_ID}/expire`))).toBe(
      true,
    );
    expect(fetchUrls.some((u: string) => u.endsWith('/charges') || u.includes('/charges?'))).toBe(
      true,
    );
  });

  // ---------------------------------------------------------------------------
  // Journey 2 — 24h unpaid cancel + stock restore + QR coexistence
  // ---------------------------------------------------------------------------
  it('Journey 2: 24h unpaid cancel restores stock; paid/young skip; idempotent; QR path coexists', async () => {
    const catalog = await seedCatalog('j2');
    const quantity = 2;
    const stockBeforeReserve = 10;

    const { order: staleOrder } = await seedGuestOrder({
      label: 'j2-stale',
      status: OrderStatus.PENDING_PAYMENT,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paymentReference: 'chrg_e2e_stale',
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      store: catalog.store,
      product: catalog.product,
      variant: catalog.variant,
      quantity,
      reserveStock: true,
    });
    await seedPayment({
      orderId: staleOrder.id,
      status: 'pending',
      paymentMethod: PaymentMethod.PROMPTPAY,
      omiseChargeId: 'chrg_e2e_stale',
      expiresAt: new Date(NOW.getTime() - ONE_HOUR_MS),
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    });

    const stockAfterReserve = (await variantRepo.findOneByOrFail({ id: catalog.variant.id }))
      .stockQuantity;
    expect(stockAfterReserve).toBe(stockBeforeReserve - quantity);

    const youngCatalog = await seedCatalog('j2-young');
    const { order: youngOrder } = await seedGuestOrder({
      label: 'j2-young',
      status: OrderStatus.PENDING_PAYMENT,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      paymentReference: 'chrg_e2e_young',
      createdAt: new Date(NOW.getTime() - ONE_HOUR_MS),
      store: youngCatalog.store,
      product: youngCatalog.product,
      variant: youngCatalog.variant,
    });
    await seedPayment({
      orderId: youngOrder.id,
      status: 'pending',
      paymentMethod: PaymentMethod.CREDIT_CARD,
      omiseChargeId: 'chrg_e2e_young',
      createdAt: new Date(NOW.getTime() - ONE_HOUR_MS),
    });

    const paidCatalog = await seedCatalog('j2-paid');
    const { order: paidOrder } = await seedGuestOrder({
      label: 'j2-paid',
      status: OrderStatus.PAID,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paymentReference: 'chrg_e2e_paid',
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
      store: paidCatalog.store,
      product: paidCatalog.product,
      variant: paidCatalog.variant,
    });
    await seedPayment({
      orderId: paidOrder.id,
      status: 'paid',
      paymentMethod: PaymentMethod.PROMPTPAY,
      omiseChargeId: 'chrg_e2e_paid',
      createdAt: new Date(NOW.getTime() - TWENTY_FIVE_HOURS_MS),
    });

    const cancelledFirst = await paymentsService.cancelStaleUnpaidOrders(NOW);
    expect(cancelledFirst).toBeGreaterThanOrEqual(1);

    const staleAfter = await orderRepo.findOneByOrFail({ id: staleOrder.id });
    expect(staleAfter.status).toBe(OrderStatus.CANCELLED);

    const stalePayments = await paymentRepo.find({ where: { orderId: staleOrder.id } });
    expect(stalePayments.every((p) => p.status === 'failed')).toBe(true);

    const stockAfterCancel = (await variantRepo.findOneByOrFail({ id: catalog.variant.id }))
      .stockQuantity;
    expect(stockAfterCancel).toBe(stockBeforeReserve);

    const returnTxns = await inventoryTxnRepo.find({
      where: {
        referenceId: staleOrder.id,
        referenceType: 'order',
        type: InventoryTransactionType.RETURN,
      },
    });
    expect(returnTxns).toHaveLength(1);
    expect(returnTxns[0].quantityChange).toBe(quantity);

    const youngAfter = await orderRepo.findOneByOrFail({ id: youngOrder.id });
    expect(youngAfter.status).toBe(OrderStatus.PENDING_PAYMENT);

    const paidAfter = await orderRepo.findOneByOrFail({ id: paidOrder.id });
    expect(paidAfter.status).toBe(OrderStatus.PAID);

    const cancelledSecond = await paymentsService.cancelStaleUnpaidOrders(NOW);
    const returnTxnsAfterReplay = await inventoryTxnRepo.find({
      where: {
        referenceId: staleOrder.id,
        referenceType: 'order',
        type: InventoryTransactionType.RETURN,
      },
    });
    expect(returnTxnsAfterReplay).toHaveLength(1);
    expect(cancelledSecond).toBeGreaterThanOrEqual(0);

    const stockAfterReplay = (await variantRepo.findOneByOrFail({ id: catalog.variant.id }))
      .stockQuantity;
    expect(stockAfterReplay).toBe(stockBeforeReserve);

    // AC-020: QR ~15m finalize path remains independently functional on a separate fixture.
    // expirePendingQrPaymentIfNeeded uses wall clock (default new Date()), so seed against Date.now().
    const qrCreatedAt = new Date(Date.now() - 20 * 60 * 1000);
    const qrCatalog = await seedCatalog('j2-qr');
    const { order: qrOrder } = await seedGuestOrder({
      label: 'j2-qr',
      status: OrderStatus.PENDING_PAYMENT,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paymentReference: 'chrg_e2e_qr',
      createdAt: qrCreatedAt,
      store: qrCatalog.store,
      product: qrCatalog.product,
      variant: qrCatalog.variant,
      quantity: 1,
      reserveStock: true,
    });
    const qrStockBefore = (await variantRepo.findOneByOrFail({ id: qrCatalog.variant.id }))
      .stockQuantity;
    const qrPayment = await seedPayment({
      orderId: qrOrder.id,
      status: 'pending',
      paymentMethod: PaymentMethod.PROMPTPAY,
      omiseChargeId: 'chrg_e2e_qr',
      expiresAt: null,
      createdAt: qrCreatedAt,
    });

    const finalized = await paymentsService.expirePendingQrPaymentIfNeeded(qrPayment);
    expect(finalized.status).toBe('failed');

    const qrOrderAfter = await orderRepo.findOneByOrFail({ id: qrOrder.id });
    expect(qrOrderAfter.status).toBe(OrderStatus.CANCELLED);

    const qrStockAfter = (await variantRepo.findOneByOrFail({ id: qrCatalog.variant.id }))
      .stockQuantity;
    expect(qrStockAfter).toBe(qrStockBefore + 1);

    expect(typeof paymentsService.expirePendingQrPayments).toBe('function');
    expect(typeof paymentsService.cancelStaleUnpaidOrders).toBe('function');
  });
});
