/**
 * Phase 0 Arrange helpers for store-commission service-integration-e2e (SVC-1 / SVC-2).
 * Consumed by backend-task-09. Do not execute those reserved describes from this module.
 *
 * Env (non-secret): `COMMISSION_GO_LIVE_AT` is a public ISO-8601 instant, not a credential.
 * P1-B1 adds it to `.env.example`. This helper sets the test value only — never production
 * Omise/JWT secrets. Redis/BullMQ is mocked; Omise is HTTP-stubbed (`POST /transfers` satang).
 */
import { JwtService } from '@nestjs/jwt';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../../src/common/interfaces';
import { User, UserRole } from '../../src/database/entities/user.entity';
import { Store, StoreStatus, OmiseRecipientStatus } from '../../src/database/entities/store.entity';
import { Product, ProductStatus } from '../../src/database/entities/product.entity';
import { ProductVariant } from '../../src/database/entities/product-variant.entity';
import { Order, OrderStatus, PaymentMethod } from '../../src/database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../../src/database/entities/order-item.entity';
import { OrderStoreShipping } from '../../src/database/entities/order-store-shipping.entity';
import { StoreShippingOption } from '../../src/database/entities/store-shipping-option.entity';
import {
  Promotion,
  PromotionScope,
  PromotionType,
} from '../../src/database/entities/promotion.entity';
import { PromotionUsage } from '../../src/database/entities/promotion-usage.entity';
import {
  Payout,
  PayoutSettlementRail,
  PayoutStatus,
} from '../../src/database/entities/payout.entity';
import { PAYOUT_SCHEDULER_QUEUE } from '../../src/modules/payouts/payout-scheduler.constants';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestUser,
  SeedRunContext,
} from './seed-factories';

/** Test-only instant. Not a secret. Planned `.env.example` key in P1-B1. */
export const STORE_COMMISSION_E2E_GO_LIVE_AT = '2026-01-01T00:00:00.000Z';
export const STORE_COMMISSION_E2E_DEFAULT_RATE_PERCENT = 7;
export const STORE_COMMISSION_E2E_JWT_SECRET = 'sopet-e2e-store-commission-jwt';
export const STORE_COMMISSION_E2E_OMISE_SECRET_KEY = 'skey_test_e2e_store_commission';
export const STORE_COMMISSION_E2E_OMISE_RECIPIENT_ID = 'recp_e2e_store_commission';
export const STORE_COMMISSION_E2E_TRANSFER_ID = 'trsf_e2e_store_commission';

/** INT-1 / SVC-1 mixed-cutoff literals (THB) after store-scoped promo on post product. */
export const STORE_COMMISSION_E2E_PRE_PRODUCT = 400;
export const STORE_COMMISSION_E2E_POST_PRODUCT_GROSS = 1100;
export const STORE_COMMISSION_E2E_POST_PROMO_DISCOUNT = 100;
export const STORE_COMMISSION_E2E_POST_PRODUCT_NET = 1000;
export const STORE_COMMISSION_E2E_POST_SHIPPING = 80;
export const STORE_COMMISSION_E2E_HOLD_SHIPPING = 50;
export const STORE_COMMISSION_E2E_HISTORICAL_PAYOUT_AMOUNT = 200;

export const STORE_COMMISSION_E2E_MIXED_FOURS = {
  productSold: 1400,
  shippingFees: 80,
  commissionAmount: 70,
  amount: 1410,
  createTransferSatang: 141_000,
} as const;

export interface StoreCommissionE2eAuthFixture {
  adminAccessToken: string;
  omiseVendorAccessToken: string;
  manualVendorAccessToken: string;
  holdVendorAccessToken: string;
}

export interface StoreCommissionMixedCutoffSet {
  store: Store;
  vendor: User;
  product: Product;
  variant: ProductVariant;
  shippingOption: StoreShippingOption;
  promotion: Promotion;
  preOrder: Order;
  postOrder: Order;
  nullPaidAtOrder: Order;
  postShipping: OrderStoreShipping;
  promotionUsage: PromotionUsage;
}

export interface StoreCommissionHoldSet {
  store: Store;
  vendor: User;
  product: Product;
  variant: ProductVariant;
  shippingOption: StoreShippingOption;
  heldOrder: Order;
  heldItem: OrderItem;
  shipping: OrderStoreShipping;
}

export interface StoreCommissionE2eSeedDataset {
  context: SeedRunContext;
  goLiveAt: Date;
  preCutoffPaidAt: Date;
  postCutoffPaidAt: Date;
  admin: User;
  omise: StoreCommissionMixedCutoffSet;
  manual: StoreCommissionMixedCutoffSet;
  hold: StoreCommissionHoldSet;
  historicalNullSnapshotPayout: Payout;
  settledHistoricalOrder: Order;
  auth: StoreCommissionE2eAuthFixture;
  tracked: StoreCommissionE2eTrackedIds;
}

export interface StoreCommissionE2eTrackedIds {
  orderIds: string[];
  variantIds: string[];
  shippingOptionIds: string[];
  promotionIds: string[];
  payoutIds: string[];
}

export function applyStoreCommissionE2eEnv(): void {
  process.env.COMMISSION_GO_LIVE_AT = STORE_COMMISSION_E2E_GO_LIVE_AT;
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = STORE_COMMISSION_E2E_JWT_SECRET;
  }
  if (!process.env.OMISE_SECRET_KEY) {
    process.env.OMISE_SECRET_KEY = STORE_COMMISSION_E2E_OMISE_SECRET_KEY;
  }
}

export function storeCommissionE2eConfigGet(key: string): unknown {
  if (key === 'commission.goLiveAt') {
    return new Date(STORE_COMMISSION_E2E_GO_LIVE_AT);
  }
  if (key === 'commission.defaultRatePercent') {
    return STORE_COMMISSION_E2E_DEFAULT_RATE_PERCENT;
  }
  if (key === 'omise.secretKey') {
    return STORE_COMMISSION_E2E_OMISE_SECRET_KEY;
  }
  if (key === 'omise.publicKey') {
    return 'pkey_test_e2e_store_commission';
  }
  if (key === 'payout.minPayoutAmount') {
    return 500;
  }
  if (key === 'jwt.secret') {
    return resolveStoreCommissionE2eJwtSecret();
  }
  return undefined;
}

export function resolveStoreCommissionE2eJwtSecret(): string {
  return process.env.JWT_SECRET ?? STORE_COMMISSION_E2E_JWT_SECRET;
}

export function signStoreCommissionAccessToken(input: {
  userId: string;
  email: string;
  role: 'admin' | 'vendor';
  storeId?: string;
}): string {
  const jwtService = new JwtService({
    secret: resolveStoreCommissionE2eJwtSecret(),
    signOptions: { expiresIn: '1h' },
  });
  const payload: JwtPayload = {
    sub: input.userId,
    email: input.email,
    role: input.role,
    type: 'access',
    ...(input.storeId ? { storeId: input.storeId } : {}),
  };
  return jwtService.sign(payload);
}

export function createStoreCommissionAuthFixture(input: {
  admin: User;
  omiseVendor: User;
  omiseStoreId: string;
  manualVendor: User;
  manualStoreId: string;
  holdVendor: User;
  holdStoreId: string;
}): StoreCommissionE2eAuthFixture {
  return {
    adminAccessToken: signStoreCommissionAccessToken({
      userId: input.admin.id,
      email: input.admin.email,
      role: 'admin',
    }),
    omiseVendorAccessToken: signStoreCommissionAccessToken({
      userId: input.omiseVendor.id,
      email: input.omiseVendor.email,
      role: 'vendor',
      storeId: input.omiseStoreId,
    }),
    manualVendorAccessToken: signStoreCommissionAccessToken({
      userId: input.manualVendor.id,
      email: input.manualVendor.email,
      role: 'vendor',
      storeId: input.manualStoreId,
    }),
    holdVendorAccessToken: signStoreCommissionAccessToken({
      userId: input.holdVendor.id,
      email: input.holdVendor.email,
      role: 'vendor',
      storeId: input.holdStoreId,
    }),
  };
}

/**
 * Stubs Omise REST at `global.fetch`. `POST /transfers` echoes satang from the body
 * (`Math.round(netAmount * 100)`). Never call live Omise.
 */
export function stubOmiseCreateTransferHttp(opts: { transferId?: string } = {}): jest.Mock {
  const transferId = opts.transferId ?? STORE_COMMISSION_E2E_TRANSFER_ID;
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (typeof url === 'string' && url.includes('/transfers') && method === 'POST') {
      const body = parseJsonBody(init?.body);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            id: transferId,
            amount: body.amount,
            currency: 'thb',
            sent: false,
            paid: false,
          }),
      });
    }
    if (typeof url === 'string' && url.includes('/recipients/')) {
      const recipientId = url.split('/').pop() ?? STORE_COMMISSION_E2E_OMISE_RECIPIENT_ID;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: recipientId, verified: true, active: true }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 'unused', status: 'pending' }),
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

export function readOmiseCreateTransferSatang(fetchMock: jest.Mock): number[] {
  const amounts: number[] = [];
  const calls = fetchMock.mock.calls as Array<[string, RequestInit | undefined]>;
  for (const [url, init] of calls) {
    if (typeof url === 'string' && url.includes('/transfers') && init?.method === 'POST') {
      const body = parseJsonBody(init.body);
      if (typeof body.amount === 'number') {
        amounts.push(body.amount);
      }
    }
  }
  return amounts;
}

export function createStoreCommissionSchedulerQueueMock(): {
  getRepeatableJobs: jest.Mock;
  add: jest.Mock;
  removeRepeatableByKey: jest.Mock;
  close: jest.Mock;
} {
  return {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue(undefined),
    removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

export const storeCommissionSchedulerMockProviders = [
  {
    provide: getQueueToken(PAYOUT_SCHEDULER_QUEUE),
    useFactory: createStoreCommissionSchedulerQueueMock,
  },
];

export async function seedStoreCommissionE2eDataset(
  dataSource: DataSource,
  context: SeedRunContext = createSeedRunContext(`sc-${Date.now()}`),
): Promise<StoreCommissionE2eSeedDataset> {
  const goLiveAt = new Date(STORE_COMMISSION_E2E_GO_LIVE_AT);
  const preCutoffPaidAt = new Date('2025-12-01T00:00:00.000Z');
  const postCutoffPaidAt = new Date('2026-06-01T00:00:00.000Z');
  const tracked = emptyTrackedIds();

  const admin = await createTestUser(dataSource, context, {
    suffix: 'admin',
    role: UserRole.ADMIN,
  });
  const omise = await seedMixedCutoffUnpaidSet(dataSource, context, tracked, {
    label: 'omise',
    connectOmiseRecipient: true,
    preCutoffPaidAt,
    postCutoffPaidAt,
  });
  const manual = await seedMixedCutoffUnpaidSet(dataSource, context, tracked, {
    label: 'manual',
    connectOmiseRecipient: false,
    preCutoffPaidAt,
    postCutoffPaidAt,
  });
  const hold = await seedHoldOnlyPostCutoffOrder(dataSource, context, tracked, {
    postCutoffPaidAt,
  });
  const settledHistoricalOrder = await seedSettledHistoricalOrder(
    dataSource,
    tracked,
    omise,
    preCutoffPaidAt,
  );
  const historicalNullSnapshotPayout = await seedHistoricalNullSnapshotPayout(
    dataSource,
    tracked,
    omise.store.id,
  );

  return {
    context,
    goLiveAt,
    preCutoffPaidAt,
    postCutoffPaidAt,
    admin,
    omise,
    manual,
    hold,
    historicalNullSnapshotPayout,
    settledHistoricalOrder,
    auth: createStoreCommissionAuthFixture({
      admin,
      omiseVendor: omise.vendor,
      omiseStoreId: omise.store.id,
      manualVendor: manual.vendor,
      manualStoreId: manual.store.id,
      holdVendor: hold.vendor,
      holdStoreId: hold.store.id,
    }),
    tracked,
  };
}

export async function cleanupStoreCommissionE2eSeed(
  dataSource: DataSource,
  dataset: Pick<StoreCommissionE2eSeedDataset, 'context' | 'tracked'>,
): Promise<void> {
  const { tracked, context } = dataset;
  if (tracked.payoutIds.length) {
    await dataSource.query(`DELETE FROM payouts WHERE id = ANY($1::uuid[])`, [tracked.payoutIds]);
  }
  if (tracked.orderIds.length) {
    await dataSource.query(`DELETE FROM promotion_usages WHERE order_id = ANY($1::uuid[])`, [
      tracked.orderIds,
    ]);
    await dataSource.query(`DELETE FROM order_store_shippings WHERE order_id = ANY($1::uuid[])`, [
      tracked.orderIds,
    ]);
    await dataSource.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [
      tracked.orderIds,
    ]);
    await dataSource.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [tracked.orderIds]);
  }
  if (tracked.promotionIds.length) {
    await dataSource.getRepository(Promotion).delete(tracked.promotionIds);
  }
  if (tracked.shippingOptionIds.length) {
    await dataSource.getRepository(StoreShippingOption).delete(tracked.shippingOptionIds);
  }
  if (tracked.variantIds.length) {
    await dataSource.getRepository(ProductVariant).delete(tracked.variantIds);
  }
  await cleanupSeedRun(dataSource, context);
}

function emptyTrackedIds(): StoreCommissionE2eTrackedIds {
  return {
    orderIds: [],
    variantIds: [],
    shippingOptionIds: [],
    promotionIds: [],
    payoutIds: [],
  };
}

function parseJsonBody(body: BodyInit | null | undefined): { amount?: number } {
  if (typeof body !== 'string') {
    return {};
  }
  return JSON.parse(body) as { amount?: number };
}

async function seedCatalog(
  dataSource: DataSource,
  context: SeedRunContext,
  tracked: StoreCommissionE2eTrackedIds,
  input: { label: string; connectOmiseRecipient: boolean; shippingPrice: number },
): Promise<{
  vendor: User;
  store: Store;
  product: Product;
  variant: ProductVariant;
  shippingOption: StoreShippingOption;
}> {
  const vendor = await createTestUser(dataSource, context, {
    suffix: `vendor-${input.label}`,
    role: UserRole.VENDOR,
  });
  let store = await createTestStore(dataSource, context, {
    suffix: `store-${input.label}`,
    ownerId: vendor.id,
    status: StoreStatus.APPROVED,
    approvedBy: vendor.id,
  });
  if (input.connectOmiseRecipient) {
    const storeRepo = dataSource.getRepository(Store);
    await storeRepo.update(store.id, {
      omiseRecipientId: STORE_COMMISSION_E2E_OMISE_RECIPIENT_ID,
      omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
    });
    store = await storeRepo.findOneByOrFail({ id: store.id });
  }
  const product = await createTestProduct(dataSource, context, {
    suffix: `product-${input.label}`,
    storeId: store.id,
    status: ProductStatus.PUBLISHED,
    name: `Commission E2E ${input.label}`,
  });
  const variant = await seedVariant(dataSource, tracked, product.id, input.label, context.runId);
  const shippingOption = await seedShippingOption(
    dataSource,
    tracked,
    store.id,
    input.label,
    input.shippingPrice,
  );
  return { vendor, store, product, variant, shippingOption };
}

async function seedVariant(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  productId: string,
  label: string,
  runId: string,
): Promise<ProductVariant> {
  const variantRepo = dataSource.getRepository(ProductVariant);
  const variant = await variantRepo.save(
    variantRepo.create({
      productId,
      sku: `SKU-SC-${label}-${runId}`.slice(0, 100),
      options: { size: 'default' },
      priceAdjustment: 0,
      stockQuantity: 50,
    }),
  );
  tracked.variantIds.push(variant.id);
  return variant;
}

async function seedShippingOption(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  storeId: string,
  label: string,
  price: number,
): Promise<StoreShippingOption> {
  const optionRepo = dataSource.getRepository(StoreShippingOption);
  const option = await optionRepo.save(
    optionRepo.create({
      storeId,
      name: `E2E Ship ${label}`,
      price,
      isActive: true,
    }),
  );
  tracked.shippingOptionIds.push(option.id);
  return option;
}

async function seedMixedCutoffUnpaidSet(
  dataSource: DataSource,
  context: SeedRunContext,
  tracked: StoreCommissionE2eTrackedIds,
  input: {
    label: string;
    connectOmiseRecipient: boolean;
    preCutoffPaidAt: Date;
    postCutoffPaidAt: Date;
  },
): Promise<StoreCommissionMixedCutoffSet> {
  const catalog = await seedCatalog(dataSource, context, tracked, {
    label: input.label,
    connectOmiseRecipient: input.connectOmiseRecipient,
    shippingPrice: STORE_COMMISSION_E2E_POST_SHIPPING,
  });
  const promotion = await seedStorePromo(dataSource, tracked, catalog.store.id, input.label);
  const preOrder = await seedPaidOrderWithItem(dataSource, tracked, {
    label: `${input.label}-pre`,
    store: catalog.store,
    product: catalog.product,
    variant: catalog.variant,
    unitPrice: STORE_COMMISSION_E2E_PRE_PRODUCT,
    quantity: 1,
    discountAmount: 0,
    shippingFee: 0,
    paidAt: input.preCutoffPaidAt,
    fulfillmentStatus: FulfillmentStatus.PENDING,
  });
  const postOrder = await seedPaidOrderWithItem(dataSource, tracked, {
    label: `${input.label}-post`,
    store: catalog.store,
    product: catalog.product,
    variant: catalog.variant,
    unitPrice: STORE_COMMISSION_E2E_POST_PRODUCT_GROSS,
    quantity: 1,
    discountAmount: STORE_COMMISSION_E2E_POST_PROMO_DISCOUNT,
    shippingFee: STORE_COMMISSION_E2E_POST_SHIPPING,
    paidAt: input.postCutoffPaidAt,
    fulfillmentStatus: FulfillmentStatus.PENDING,
  });
  const nullPaidAtOrder = await seedPaidOrderWithItem(dataSource, tracked, {
    label: `${input.label}-null-paid`,
    store: catalog.store,
    product: catalog.product,
    variant: catalog.variant,
    unitPrice: 50,
    quantity: 1,
    discountAmount: 0,
    shippingFee: 0,
    paidAt: null,
    fulfillmentStatus: FulfillmentStatus.PENDING,
  });
  const postShipping = await seedStoreShipping(
    dataSource,
    postOrder.order.id,
    catalog.store.id,
    catalog.shippingOption,
    STORE_COMMISSION_E2E_POST_SHIPPING,
  );
  const promotionUsage = await seedPromotionUsage(
    dataSource,
    promotion.id,
    postOrder.order.id,
    STORE_COMMISSION_E2E_POST_PROMO_DISCOUNT,
  );
  return {
    ...catalog,
    promotion,
    preOrder: preOrder.order,
    postOrder: postOrder.order,
    nullPaidAtOrder: nullPaidAtOrder.order,
    postShipping,
    promotionUsage,
  };
}

async function seedHoldOnlyPostCutoffOrder(
  dataSource: DataSource,
  context: SeedRunContext,
  tracked: StoreCommissionE2eTrackedIds,
  input: { postCutoffPaidAt: Date },
): Promise<StoreCommissionHoldSet> {
  const catalog = await seedCatalog(dataSource, context, tracked, {
    label: 'hold',
    connectOmiseRecipient: false,
    shippingPrice: STORE_COMMISSION_E2E_HOLD_SHIPPING,
  });
  const seeded = await seedPaidOrderWithItem(dataSource, tracked, {
    label: 'hold-post',
    store: catalog.store,
    product: catalog.product,
    variant: catalog.variant,
    unitPrice: 300,
    quantity: 1,
    discountAmount: 0,
    shippingFee: STORE_COMMISSION_E2E_HOLD_SHIPPING,
    paidAt: input.postCutoffPaidAt,
    fulfillmentStatus: FulfillmentStatus.ON_HOLD,
  });
  const shipping = await seedStoreShipping(
    dataSource,
    seeded.order.id,
    catalog.store.id,
    catalog.shippingOption,
    STORE_COMMISSION_E2E_HOLD_SHIPPING,
  );
  return {
    ...catalog,
    heldOrder: seeded.order,
    heldItem: seeded.item,
    shipping,
  };
}

async function seedSettledHistoricalOrder(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  omise: StoreCommissionMixedCutoffSet,
  preCutoffPaidAt: Date,
): Promise<Order> {
  const seeded = await seedPaidOrderWithItem(dataSource, tracked, {
    label: 'omise-historical',
    store: omise.store,
    product: omise.product,
    variant: omise.variant,
    unitPrice: STORE_COMMISSION_E2E_HISTORICAL_PAYOUT_AMOUNT,
    quantity: 1,
    discountAmount: 0,
    shippingFee: 0,
    paidAt: preCutoffPaidAt,
    fulfillmentStatus: FulfillmentStatus.DELIVERED,
  });
  return seeded.order;
}

async function seedHistoricalNullSnapshotPayout(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  storeId: string,
): Promise<Payout> {
  const payoutRepo = dataSource.getRepository(Payout);
  const payout = await payoutRepo.save(
    payoutRepo.create({
      storeId,
      amount: STORE_COMMISSION_E2E_HISTORICAL_PAYOUT_AMOUNT,
      fee: 0,
      netAmount: STORE_COMMISSION_E2E_HISTORICAL_PAYOUT_AMOUNT,
      status: PayoutStatus.COMPLETED,
      settlementRail: PayoutSettlementRail.OMISE,
      notes: 'e2e historical NULL-snapshot (no fours columns; do not backfill)',
    }),
  );
  tracked.payoutIds.push(payout.id);
  return payout;
}

async function seedStorePromo(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  storeId: string,
  label: string,
): Promise<Promotion> {
  const promoRepo = dataSource.getRepository(Promotion);
  const promotion = await promoRepo.save(
    promoRepo.create({
      storeId,
      code: `SC-${label}-${Date.now()}`.slice(0, 50),
      name: `E2E store promo ${label}`,
      type: PromotionType.FIXED_AMOUNT,
      scope: PromotionScope.STORE,
      discountValue: STORE_COMMISSION_E2E_POST_PROMO_DISCOUNT,
      usagePerCustomer: 0,
      usageCount: 1,
      isActive: true,
      conditions: {},
    }),
  );
  tracked.promotionIds.push(promotion.id);
  return promotion;
}

async function seedPromotionUsage(
  dataSource: DataSource,
  promotionId: string,
  orderId: string,
  discountAmount: number,
): Promise<PromotionUsage> {
  const usageRepo = dataSource.getRepository(PromotionUsage);
  return usageRepo.save(
    usageRepo.create({
      promotionId,
      orderId,
      discountAmount,
    }),
  );
}

async function seedStoreShipping(
  dataSource: DataSource,
  orderId: string,
  storeId: string,
  option: StoreShippingOption,
  shippingFee: number,
): Promise<OrderStoreShipping> {
  const shippingRepo = dataSource.getRepository(OrderStoreShipping);
  return shippingRepo.save(
    shippingRepo.create({
      orderId,
      storeId,
      shippingOptionId: option.id,
      optionName: option.name,
      shippingFee,
    }),
  );
}

async function seedPaidOrderWithItem(
  dataSource: DataSource,
  tracked: StoreCommissionE2eTrackedIds,
  input: {
    label: string;
    store: Store;
    product: Product;
    variant: ProductVariant;
    unitPrice: number;
    quantity: number;
    discountAmount: number;
    shippingFee: number;
    paidAt: Date | null;
    fulfillmentStatus: FulfillmentStatus;
  },
): Promise<{ order: Order; item: OrderItem }> {
  const orderRepo = dataSource.getRepository(Order);
  const itemRepo = dataSource.getRepository(OrderItem);
  const subtotal = input.unitPrice * input.quantity;
  const total = subtotal - input.discountAmount + input.shippingFee;
  const order = await orderRepo.save(
    orderRepo.create({
      orderNumber: `E2E-SC-${input.label}-${Date.now()}`.slice(0, 50),
      customerId: null,
      guestPhone: '+66812345678',
      guestName: `Commission ${input.label}`,
      status: OrderStatus.PAID,
      subtotal,
      discountAmount: input.discountAmount,
      shippingFee: input.shippingFee,
      total,
      paymentMethod: PaymentMethod.PROMPTPAY,
      paidAt: input.paidAt,
    }),
  );
  tracked.orderIds.push(order.id);
  const item = await itemRepo.save(
    itemRepo.create({
      orderId: order.id,
      storeId: input.store.id,
      variantId: input.variant.id,
      productName: input.product.name,
      variantOptions: { size: 'default' },
      unitPrice: input.unitPrice,
      quantity: input.quantity,
      subtotal,
      fulfillmentStatus: input.fulfillmentStatus,
      previousFulfillmentStatus:
        input.fulfillmentStatus === FulfillmentStatus.ON_HOLD ? FulfillmentStatus.PENDING : null,
      holdStartedAt: input.fulfillmentStatus === FulfillmentStatus.ON_HOLD ? new Date() : null,
    }),
  );
  return { order, item };
}
