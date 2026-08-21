// Store Commission [service-integration-e2e]
// Promoted from test/store-commission.service.e2e.test.ts
// Design Doc: store-commission-backend-design.md (v1.3)
// Frontend Design Doc: store-commission-frontend-design.md (v1.2)
// UI Spec: store-commission-ui-spec.md (v1.1 Approved)
// PRD: store-commission-prd.md (AC-001–AC-028)
//
// Run (requires local Postgres — `yarn docker:up`; soft-skips in CI without Docker):
//   yarn test:e2e --testPathPatterns=store-commission.service
//
// @real-dependency: PostgreSQL (stores, payouts, orders, order_items, order_store_shippings)
// @real-dependency: PayoutsService createOmisePayout + requestManualPayout + getPayoutSummary
// @real-dependency: StoresService.updateAsAdmin
// @real-dependency: payout-commission.calculator (pure)
// Mock: Omise HTTP only (createTransfer satang = Math.round(netAmount * 100))
// Mock: Redis / BullMQ scheduler
//
// Registered by test/jest-e2e.json testRegex: ".e2e-spec.ts$"

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { PayoutsResolver } from '../src/modules/payouts/payouts.resolver';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { OmiseService } from '../src/modules/omise/omise.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { StoreSuspensionHoldService } from '../src/modules/orders/store-suspension-hold.service';
import { EmailDeliveryService } from '../src/modules/email/email-delivery.service';
import { Payout } from '../src/database/entities/payout.entity';
import { Store } from '../src/database/entities/store.entity';
import { User } from '../src/database/entities/user.entity';
import { Customer } from '../src/database/entities/customer.entity';
import { StoreMember } from '../src/database/entities/store-member.entity';
import { Order, OrderStatus, PaymentMethod } from '../src/database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../src/database/entities/order-item.entity';
import { OrderStoreShipping } from '../src/database/entities/order-store-shipping.entity';
import { StoreShippingOption } from '../src/database/entities/store-shipping-option.entity';
import { Product } from '../src/database/entities/product.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import { Promotion } from '../src/database/entities/promotion.entity';
import { PromotionUsage } from '../src/database/entities/promotion-usage.entity';
import { AuditLog } from '../src/database/entities/audit-log.entity';
import { isPostgresAvailable } from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';
import {
  STORE_COMMISSION_E2E_HOLD_PRODUCT,
  STORE_COMMISSION_E2E_HOLD_SHIPPING,
  STORE_COMMISSION_E2E_MIXED_FOURS,
  STORE_COMMISSION_E2E_NULL_PAID_AT_PRODUCT,
  applyStoreCommissionE2eEnv,
  cleanupStoreCommissionE2eSeed,
  readOmiseCreateTransferSatang,
  seedStoreCommissionE2eDataset,
  storeCommissionE2eConfigGet,
  storeCommissionSchedulerMockProviders,
  stubOmiseCreateTransferHttp,
  type StoreCommissionE2eSeedDataset,
} from './helpers/store-commission-e2e.seed';

const TRIGGER_PAYOUT = `
  mutation TriggerPayout($input: TriggerPayoutInput!) {
    triggerPayout(input: $input) {
      id
      amount
      netAmount
      productSold
      shippingFees
      commissionAmount
      commissionRate
      status
      settlementRail
    }
  }
`;

const REQUEST_MANUAL_PAYOUT = `
  mutation RequestManualPayout {
    requestManualPayout {
      id
      amount
      netAmount
      productSold
      shippingFees
      commissionAmount
      commissionRate
      status
      settlementRail
    }
  }
`;

const ADMIN_STORE_PAYOUT_SUMMARY = `
  query AdminStorePayoutSummary($storeId: String!) {
    adminStorePayoutSummary(storeId: $storeId) {
      availableBalance
      productSold
      shippingFees
      commissionAmount
      commissionRate
    }
  }
`;

const LEFTOVER_POST_PRODUCT = 1000;

/** Mixed fours plus NULL paid_at pre product (0% commission, shipping excluded). */
const SVC1_FOURS = {
  productSold:
    STORE_COMMISSION_E2E_MIXED_FOURS.productSold + STORE_COMMISSION_E2E_NULL_PAID_AT_PRODUCT,
  shippingFees: STORE_COMMISSION_E2E_MIXED_FOURS.shippingFees,
  commissionAmount: STORE_COMMISSION_E2E_MIXED_FOURS.commissionAmount,
  amount: STORE_COMMISSION_E2E_MIXED_FOURS.amount + STORE_COMMISSION_E2E_NULL_PAID_AT_PRODUCT,
  createTransferSatang: Math.round(
    (STORE_COMMISSION_E2E_MIXED_FOURS.amount + STORE_COMMISSION_E2E_NULL_PAID_AT_PRODUCT) * 100,
  ),
} as const;

type PayoutSnapshotSql = {
  id: string;
  amount: string;
  fee: string;
  net_amount: string;
  commission_rate: number | null;
  product_sold: string | null;
  shipping_fees: string | null;
  commission_amount: string | null;
};

type GraphqlBody<T> = {
  data: T;
  errors?: unknown;
};

type PayoutGraphql = {
  id: string;
  amount: number;
  netAmount: number;
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
};

type PayoutSummaryGraphql = {
  availableBalance: number;
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
};

describe('store commission service-integration-e2e harness', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let payoutsService: PayoutsService;
  let storesService: StoresService;
  let omiseFetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    applyStoreCommissionE2eEnv();
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    omiseFetchMock = stubOmiseCreateTransferHttp();

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([
          Payout,
          Store,
          User,
          Customer,
          StoreMember,
          Order,
          OrderItem,
          OrderStoreShipping,
          StoreShippingOption,
          Product,
          ProductVariant,
          Promotion,
          PromotionUsage,
          AuditLog,
        ]),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        }),
      ],
      providers: [
        PayoutsResolver,
        PayoutsService,
        StoresService,
        OmiseService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        {
          provide: ConfigService,
          useValue: { get: storeCommissionE2eConfigGet },
        },
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: NotificationsService,
          useValue: { notifyAdminsAboutManualPayoutRequest: jest.fn() },
        },
        { provide: StorageService, useValue: {} },
        {
          provide: StoreSuspensionHoldService,
          useValue: {
            applyHoldForStore: jest.fn(),
            restoreHoldForStore: jest.fn(),
          },
        },
        { provide: EmailDeliveryService, useValue: {} },
        ...storeCommissionSchedulerMockProviders,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    payoutsService = moduleFixture.get(PayoutsService);
    storesService = moduleFixture.get(StoresService);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (app) {
      await app.close();
    }
  });

  function skipWithoutPostgres(): boolean {
    return !postgresAvailable;
  }

  async function readPayoutSnapshotSql(payoutId: string): Promise<PayoutSnapshotSql> {
    const rows = await dataSource.query<PayoutSnapshotSql[]>(
      `SELECT id, amount, fee, net_amount, commission_rate, product_sold, shipping_fees, commission_amount
       FROM payouts WHERE id = $1`,
      [payoutId],
    );
    return rows[0];
  }

  async function postGraphql<T>(
    token: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphqlBody<T>> {
    const res = await request(app!.getHttpServer() as App)
      .post('/graphql')
      .set('Authorization', `Bearer ${token}`)
      .send({ query, variables })
      .expect(200);
    const body = res.body as GraphqlBody<T>;
    expect(body.errors).toBeUndefined();
    return body;
  }

  function expectSnapshotIdentity(
    row: PayoutSnapshotSql,
    expected: {
      productSold: number;
      shippingFees: number;
      commissionAmount: number;
      amount: number;
      commissionRate: number;
    },
  ): void {
    expect(row.commission_rate).toBe(expected.commissionRate);
    expect(Number(row.product_sold)).toBe(expected.productSold);
    expect(Number(row.shipping_fees)).toBe(expected.shippingFees);
    expect(Number(row.commission_amount)).toBe(expected.commissionAmount);
    expect(Number(row.amount)).toBe(expected.amount);
    expect(Number(row.net_amount)).toBe(expected.amount);
    expect(Number(row.fee)).toBe(0);
    expect(Number(row.amount)).toBe(
      Number(row.product_sold) - Number(row.commission_amount) + Number(row.shipping_fees),
    );
  }

  async function seedLeftoverPostCutoffOrder(
    dataset: StoreCommissionE2eSeedDataset,
    productSold: number,
  ): Promise<void> {
    const orderRepo = dataSource.getRepository(Order);
    const itemRepo = dataSource.getRepository(OrderItem);
    const order = await orderRepo.save(
      orderRepo.create({
        orderNumber: `E2E-SC-leftover-${Date.now()}`.slice(0, 50),
        customerId: null,
        guestPhone: '+66812345678',
        guestName: 'Commission leftover',
        status: OrderStatus.PAID,
        subtotal: productSold,
        discountAmount: 0,
        shippingFee: 0,
        total: productSold,
        paymentMethod: PaymentMethod.PROMPTPAY,
        paidAt: dataset.postCutoffPaidAt,
      }),
    );
    dataset.tracked.orderIds.push(order.id);
    await itemRepo.save(
      itemRepo.create({
        orderId: order.id,
        storeId: dataset.omise.store.id,
        variantId: dataset.omise.variant.id,
        productName: dataset.omise.product.name,
        variantOptions: { size: 'default' },
        unitPrice: productSold,
        quantity: 1,
        subtotal: productSold,
        fulfillmentStatus: FulfillmentStatus.PENDING,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // SVC-1 (RESERVED service-integration-e2e slot)
  // AC-007: "When an Omise-rail payout is created, then commission is applied at that create using
  // the effective rate on post-cutoff product only; amount and netAmount equal the computed net; fee is 0."
  // AC-008: "When a manual-rail payout is created, then the same product / cutoff / shipping /
  // rounding rules as the Omise rail apply."
  // AC-017: "When a payout is created, then amount (and netAmount) equal the snapshotted net so
  // /admin/manual-payouts binding amount is already-net."
  // AC-018: "When payout create succeeds, then commission_rate, product_sold, shipping_fees,
  // commission_amount are persisted in the same transaction as the insert."
  // AC-019: "When a pending payout exists and admin later changes the store rate, then that payout’s
  // snapshot columns and amount do not change."
  // AC-021 / AC-022 / AC-023: post-cutoff commissioned + shipping; pre-cutoff 0% and shipping
  // excluded; one combined fours (no pre/post pair columns).
  // AC-028: leftover unpaid post after a rate change uses the current effective rate.
  // ROI: 120
  // Behavior: Running Nest + real Postgres: mixed unpaid set → create Omise payout (omit amount) →
  // create manual payout on a second store/rail-equivalent set → SQL row has fours + amount ===
  // derived net → updateStoreAsAdmin to a new rate → first payout row unchanged → getPayoutSummary
  // leftover uses the new rate.
  // @category: service-integration-e2e
  // @lane: service-integration-e2e
  // @dependency: full-system (local Nest + real Postgres), admin JWT, vendor JWT, Omise HTTP stub
  // @complexity: high
  describe('store commission — payout snapshot persistence [service-integration-e2e]', () => {
    it('persists combined fours and already-net amount on both rails and keeps a pending snapshot frozen after a later rate edit', async () => {
      if (skipWithoutPostgres()) {
        return;
      }

      const dataset = await seedStoreCommissionE2eDataset(dataSource);
      omiseFetchMock.mockClear();

      try {
        const omiseGql = await postGraphql<{ triggerPayout: PayoutGraphql }>(
          dataset.auth.adminAccessToken,
          TRIGGER_PAYOUT,
          { input: { storeId: dataset.omise.store.id } },
        );
        const omisePayout = omiseGql.data.triggerPayout;
        dataset.tracked.payoutIds.push(omisePayout.id);

        expect(omisePayout.amount).toBe(SVC1_FOURS.amount);
        expect(omisePayout.netAmount).toBe(SVC1_FOURS.amount);
        expect(omisePayout.productSold).toBe(SVC1_FOURS.productSold);
        expect(omisePayout.shippingFees).toBe(SVC1_FOURS.shippingFees);
        expect(omisePayout.commissionAmount).toBe(SVC1_FOURS.commissionAmount);
        expect(omisePayout.commissionRate).toBe(7);
        expect(omisePayout).not.toHaveProperty('pre_productSold');
        expect(omisePayout).not.toHaveProperty('post_productSold');

        const omiseSql = await readPayoutSnapshotSql(omisePayout.id);
        expectSnapshotIdentity(omiseSql, { ...SVC1_FOURS, commissionRate: 7 });
        expect(Number(omiseSql.amount)).toBe(omisePayout.amount);

        const pairColumns = await dataSource.query<Array<{ column_name: string }>>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'payouts'
             AND (column_name LIKE 'pre_%' OR column_name LIKE 'post_%')`,
        );
        expect(pairColumns).toEqual([]);

        expect(readOmiseCreateTransferSatang(omiseFetchMock)).toEqual([
          SVC1_FOURS.createTransferSatang,
        ]);

        const transferCallsBeforeManual = omiseFetchMock.mock.calls.filter(
          (call: [string, RequestInit | undefined]) =>
            typeof call[0] === 'string' &&
            call[0].includes('/transfers') &&
            call[1]?.method === 'POST',
        ).length;

        const manualGql = await postGraphql<{ requestManualPayout: PayoutGraphql }>(
          dataset.auth.manualVendorAccessToken,
          REQUEST_MANUAL_PAYOUT,
        );
        const manualPayout = manualGql.data.requestManualPayout;
        dataset.tracked.payoutIds.push(manualPayout.id);

        const manualSql = await readPayoutSnapshotSql(manualPayout.id);
        expectSnapshotIdentity(manualSql, { ...SVC1_FOURS, commissionRate: 7 });
        expect(Number(manualSql.amount)).toBe(manualPayout.amount);
        expect(manualPayout.amount).toBe(omisePayout.amount);

        const transferCallsAfterManual = omiseFetchMock.mock.calls.filter(
          (call: [string, RequestInit | undefined]) =>
            typeof call[0] === 'string' &&
            call[0].includes('/transfers') &&
            call[1]?.method === 'POST',
        ).length;
        expect(transferCallsAfterManual).toBe(transferCallsBeforeManual);

        const frozen = {
          amount: Number(omiseSql.amount),
          netAmount: Number(omiseSql.net_amount),
          productSold: Number(omiseSql.product_sold),
          shippingFees: Number(omiseSql.shipping_fees),
          commissionAmount: Number(omiseSql.commission_amount),
          commissionRate: omiseSql.commission_rate,
        };

        await seedLeftoverPostCutoffOrder(dataset, LEFTOVER_POST_PRODUCT);

        const leftoverAtSeven = await payoutsService.getPayoutSummary(dataset.omise.store.id);
        expect(leftoverAtSeven.productSold).toBe(LEFTOVER_POST_PRODUCT);
        expect(leftoverAtSeven.commissionAmount).toBe(70);
        expect(leftoverAtSeven.commissionRate).toBe(7);
        expect(leftoverAtSeven.availableBalance).toBe(930);

        await storesService.updateAsAdmin({
          id: dataset.omise.store.id,
          commissionRate: 10,
        });

        const reread = await readPayoutSnapshotSql(omisePayout.id);
        expect(Number(reread.amount)).toBe(frozen.amount);
        expect(Number(reread.net_amount)).toBe(frozen.netAmount);
        expect(Number(reread.product_sold)).toBe(frozen.productSold);
        expect(Number(reread.shipping_fees)).toBe(frozen.shippingFees);
        expect(Number(reread.commission_amount)).toBe(frozen.commissionAmount);
        expect(reread.commission_rate).toBe(frozen.commissionRate);

        const leftoverGql = await postGraphql<{
          adminStorePayoutSummary: PayoutSummaryGraphql;
        }>(dataset.auth.adminAccessToken, ADMIN_STORE_PAYOUT_SUMMARY, {
          storeId: dataset.omise.store.id,
        });
        const leftover = leftoverGql.data.adminStorePayoutSummary;
        expect(leftover.productSold).toBe(LEFTOVER_POST_PRODUCT);
        expect(leftover.shippingFees).toBe(0);
        expect(leftover.commissionAmount).toBe(100);
        expect(leftover.commissionRate).toBe(10);
        expect(leftover.availableBalance).toBe(900);

        const historical = await readPayoutSnapshotSql(dataset.historicalNullSnapshotPayout.id);
        expect(historical.commission_rate).toBeNull();
        expect(historical.product_sold).toBeNull();
        expect(historical.shipping_fees).toBeNull();
        expect(historical.commission_amount).toBeNull();
      } finally {
        await cleanupStoreCommissionE2eSeed(dataSource, dataset);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // SVC-2 (additional service-e2e — ROI 60 > 50 threshold)
  // AC-025: "While an item is on_hold (or the order is on_hold), then that portion is excluded from
  // item product and that store’s shipping is excluded unless another non-held eligible line remains."
  // AC-026: "When held items leave hold, then they re-enter eligibility under this PRD’s cutoff and
  // commission rules."
  // ROI: 60
  // Behavior: Against real Postgres hold SQL + order_store_shippings join, a held-only post-cutoff
  // store/order contributes 0 product and 0 shipping to create/summary; after a real leave-hold
  // update, the same order re-enters under cutoff + current rate.
  // @category: service-integration-e2e
  // @lane: service-integration-e2e
  // @dependency: full-system, real Postgres hold columns + shipping rows
  // @complexity: medium
  describe('store commission — hold exclusion against real eligibility SQL [service-integration-e2e]', () => {
    it('keeps on_hold portions and held-only shipping out of persisted payout totals until leave-hold', async () => {
      if (skipWithoutPostgres()) {
        return;
      }

      const dataset = await seedStoreCommissionE2eDataset(dataSource);

      try {
        const heldSummary = await payoutsService.getPayoutSummary(dataset.hold.store.id);
        expect(heldSummary.productSold).toBe(0);
        expect(heldSummary.shippingFees).toBe(0);
        expect(heldSummary.commissionAmount).toBe(0);
        expect(heldSummary.availableBalance).toBe(0);
        expect(heldSummary.omise.productSold).toBe(0);
        expect(heldSummary.omise.shippingFees).toBe(0);

        await expect(
          payoutsService.triggerPayout(dataset.hold.store.id, { bypassMinimum: true }),
        ).rejects.toMatchObject({ response: { code: 'INVALID_PAYOUT_AMOUNT' } });

        await dataSource.query(
          `UPDATE order_items
           SET fulfillment_status = $1,
               previous_fulfillment_status = NULL,
               hold_started_at = NULL
           WHERE id = $2`,
          [FulfillmentStatus.PENDING, dataset.hold.heldItem.id],
        );

        const restored = await payoutsService.getPayoutSummary(dataset.hold.store.id);
        expect(restored.productSold).toBe(STORE_COMMISSION_E2E_HOLD_PRODUCT);
        expect(restored.shippingFees).toBe(STORE_COMMISSION_E2E_HOLD_SHIPPING);
        expect(restored.commissionAmount).toBe(21);
        expect(restored.commissionRate).toBe(7);
        expect(restored.availableBalance).toBe(329);
        expect(restored.availableBalance).toBe(
          restored.productSold - restored.commissionAmount + restored.shippingFees,
        );
      } finally {
        await cleanupStoreCommissionE2eSeed(dataSource, dataset);
      }
    });
  });
});
