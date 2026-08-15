// Store Commission [integration]
// Design Doc: store-commission-backend-design.md (v1.3)
// Frontend Design Doc: store-commission-frontend-design.md (v1.2)
// UI Spec: store-commission-ui-spec.md (v1.1 Approved)
// PRD: store-commission-prd.md (AC-001–AC-028)
// Promoted from test/store-commission.int.test.ts
//
// Harness: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST; seeded PostgreSQL
// Mock: Omise HTTP only (createTransfer still receives Math.round(netAmount * 100))
// @real-dependency: payout-commission.calculator
// @real-dependency: PostgreSQL
//
// INT-3 hold shipping is out of scope (backend-task-08).

import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GqlExecutionContext } from '@nestjs/graphql';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { PayoutsResolver } from '../src/modules/payouts/payouts.resolver';
import { PayoutsService } from '../src/modules/payouts/payouts.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { OmiseService } from '../src/modules/omise/omise.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { StoreSuspensionHoldService } from '../src/modules/orders/store-suspension-hold.service';
import { EmailDeliveryService } from '../src/modules/email/email-delivery.service';
import { Payout, PayoutSettlementRail, PayoutStatus } from '../src/database/entities/payout.entity';
import { Store, StoreStatus, OmiseRecipientStatus } from '../src/database/entities/store.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { StoreMember } from '../src/database/entities/store-member.entity';
import { Order, OrderStatus, PaymentMethod } from '../src/database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../src/database/entities/order-item.entity';
import { OrderStoreShipping } from '../src/database/entities/order-store-shipping.entity';
import { StoreShippingOption } from '../src/database/entities/store-shipping-option.entity';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import {
  Promotion,
  PromotionScope,
  PromotionType,
} from '../src/database/entities/promotion.entity';
import { PromotionUsage } from '../src/database/entities/promotion-usage.entity';
import { AuditLog } from '../src/database/entities/audit-log.entity';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestUser,
  isPostgresAvailable,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

const GO_LIVE_AT = new Date('2026-06-01T00:00:00.000Z');
const PRE_PAID_AT = new Date('2026-05-01T00:00:00.000Z');
const POST_PAID_AT = new Date('2026-07-01T00:00:00.000Z');

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

const ADMIN_STORE_PAYOUTS = `
  query AdminStorePayouts($storeId: String!) {
    adminStorePayouts(storeId: $storeId) {
      id
      amount
      netAmount
      productSold
      shippingFees
      commissionAmount
      commissionRate
    }
  }
`;

const PENDING_MANUAL = `
  query PendingManualPayouts {
    pendingManualPayouts {
      items {
        id
        storeId
        amount
        netAmount
        productSold
        shippingFees
        commissionAmount
        commissionRate
      }
    }
  }
`;

describe('store commission — mixed-cutoff payout create [integration]', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let payoutsService: PayoutsService;
  let payoutRepo: Repository<Payout>;
  let storeRepo: Repository<Store>;
  let orderRepo: Repository<Order>;
  let orderItemRepo: Repository<OrderItem>;
  let variantRepo: Repository<ProductVariant>;
  let shippingOptionRepo: Repository<StoreShippingOption>;
  let storeShippingRepo: Repository<OrderStoreShipping>;
  let promotionRepo: Repository<Promotion>;
  let promotionUsageRepo: Repository<PromotionUsage>;

  const seedContext = createSeedRunContext(`store-commission-${Date.now()}`);
  const tracked = {
    payoutIds: [] as string[],
    orderIds: [] as string[],
    itemIds: [] as string[],
    variantIds: [] as string[],
    shippingOptionIds: [] as string[],
    storeShippingIds: [] as string[],
    promotionIds: [] as string[],
    promotionUsageIds: [] as string[],
  };

  const omiseCreateTransfer = jest.fn();

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    const adminGuard: CanActivate = {
      canActivate(context: ExecutionContext) {
        const gql = GqlExecutionContext.create(context);
        const req = gql.getContext<{ req?: { user?: Record<string, unknown> } }>().req;
        if (req) {
          req.user = {
            id: '11111111-1111-4111-8111-111111111111',
            role: 'admin',
            email: 'admin@e2e.test',
          };
        }
        return true;
      },
    };

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([
          Payout,
          Store,
          User,
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
        RolesGuard,
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'payout.minPayoutAmount') return 500;
              if (key === 'commission.defaultRatePercent') return 7;
              if (key === 'commission.goLiveAt') return GO_LIVE_AT;
              return undefined;
            },
          },
        },
        {
          provide: OmiseService,
          useValue: {
            hasCredentials: jest.fn().mockReturnValue(true),
            getRecipient: jest.fn().mockResolvedValue({
              id: 'recp_int1',
              verified: true,
              active: true,
            }),
            createTransfer: omiseCreateTransfer,
          },
        },
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
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(adminGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    payoutsService = moduleFixture.get(PayoutsService);
    payoutRepo = moduleFixture.get(getRepositoryToken(Payout));
    storeRepo = moduleFixture.get(getRepositoryToken(Store));
    orderRepo = moduleFixture.get(getRepositoryToken(Order));
    orderItemRepo = moduleFixture.get(getRepositoryToken(OrderItem));
    variantRepo = moduleFixture.get(getRepositoryToken(ProductVariant));
    shippingOptionRepo = moduleFixture.get(getRepositoryToken(StoreShippingOption));
    storeShippingRepo = moduleFixture.get(getRepositoryToken(OrderStoreShipping));
    promotionRepo = moduleFixture.get(getRepositoryToken(Promotion));
    promotionUsageRepo = moduleFixture.get(getRepositoryToken(PromotionUsage));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupTracked();
      await cleanupSeedRun(dataSource, seedContext);
    }
    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    omiseCreateTransfer.mockReset();
    if (dataSource?.isInitialized) {
      await cleanupTracked();
    }
  });

  function skipWithoutPostgres(): boolean {
    if (!postgresAvailable) {
      return true;
    }
    return false;
  }

  async function cleanupTracked(): Promise<void> {
    if (tracked.payoutIds.length) {
      await payoutRepo.delete(tracked.payoutIds);
      tracked.payoutIds = [];
    }
    if (tracked.promotionUsageIds.length) {
      await promotionUsageRepo.delete(tracked.promotionUsageIds);
      tracked.promotionUsageIds = [];
    }
    if (tracked.promotionIds.length) {
      await promotionRepo.delete(tracked.promotionIds);
      tracked.promotionIds = [];
    }
    if (tracked.storeShippingIds.length) {
      await storeShippingRepo.delete(tracked.storeShippingIds);
      tracked.storeShippingIds = [];
    }
    if (tracked.itemIds.length) {
      await orderItemRepo.delete(tracked.itemIds);
      tracked.itemIds = [];
    }
    if (tracked.orderIds.length) {
      await orderRepo.delete(tracked.orderIds);
      tracked.orderIds = [];
    }
    if (tracked.shippingOptionIds.length) {
      await shippingOptionRepo.delete(tracked.shippingOptionIds);
      tracked.shippingOptionIds = [];
    }
    if (tracked.variantIds.length) {
      await variantRepo.delete(tracked.variantIds);
      tracked.variantIds = [];
    }
  }

  async function seedStore(suffix: string, rail: 'omise' | 'manual'): Promise<Store> {
    const owner = await createTestUser(dataSource, seedContext, {
      suffix: `${suffix}-owner`,
      role: UserRole.VENDOR,
    });
    const store = await createTestStore(dataSource, seedContext, {
      suffix,
      ownerId: owner.id,
      status: StoreStatus.APPROVED,
      approvedBy: owner.id,
    });
    if (rail === 'omise') {
      store.omiseRecipientId = `recp_${suffix}`;
      store.omiseRecipientStatus = OmiseRecipientStatus.ACTIVE;
      await storeRepo.save(store);
    }
    return store;
  }

  async function seedCatalog(store: Store, label: string) {
    const product = await createTestProduct(dataSource, seedContext, {
      suffix: `${label}-prod`,
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `Commission ${label}`,
    });
    const variant = await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: `SKU-SC-${label}-${seedContext.runId}`.slice(0, 100),
        options: { size: 'default' },
        priceAdjustment: 0,
        stockQuantity: 50,
      }),
    );
    tracked.variantIds.push(variant.id);
    const shippingOption = await shippingOptionRepo.save(
      shippingOptionRepo.create({
        storeId: store.id,
        name: 'Standard',
        price: 80,
        isActive: true,
      }),
    );
    tracked.shippingOptionIds.push(shippingOption.id);
    return { product, variant, shippingOption };
  }

  async function seedPaidOrder(input: {
    store: Store;
    productName: string;
    variant: ProductVariant;
    paymentMethod: PaymentMethod;
    paidAt: Date | null;
    itemSubtotal: number;
    orderNumber: string;
    shippingFee?: number;
    shippingOptionId?: string;
    promoDiscount?: number;
  }): Promise<Order> {
    const order = await orderRepo.save(
      orderRepo.create({
        orderNumber: input.orderNumber.slice(0, 50),
        customerId: null,
        guestPhone: '+66812345678',
        guestName: 'Commission Guest',
        status: OrderStatus.PAID,
        subtotal: input.itemSubtotal,
        discountAmount: input.promoDiscount ?? 0,
        shippingFee: input.shippingFee ?? 0,
        total: input.itemSubtotal + (input.shippingFee ?? 0) - (input.promoDiscount ?? 0),
        paymentMethod: input.paymentMethod,
        paidAt: input.paidAt,
      }),
    );
    tracked.orderIds.push(order.id);

    const item = await orderItemRepo.save(
      orderItemRepo.create({
        orderId: order.id,
        storeId: input.store.id,
        variantId: input.variant.id,
        productName: input.productName,
        variantOptions: { size: 'default' },
        unitPrice: input.itemSubtotal,
        quantity: 1,
        subtotal: input.itemSubtotal,
        fulfillmentStatus: FulfillmentStatus.PENDING,
      }),
    );
    tracked.itemIds.push(item.id);

    if (input.shippingFee && input.shippingOptionId) {
      const row = await storeShippingRepo.save(
        storeShippingRepo.create({
          orderId: order.id,
          storeId: input.store.id,
          shippingOptionId: input.shippingOptionId,
          optionName: 'Standard',
          shippingFee: input.shippingFee,
        }),
      );
      tracked.storeShippingIds.push(row.id);
    }

    if (input.promoDiscount && input.promoDiscount > 0) {
      const promo = await promotionRepo.save(
        promotionRepo.create({
          storeId: input.store.id,
          code: `SC-${input.orderNumber}`.slice(0, 50),
          name: 'Store promo',
          type: PromotionType.FIXED_AMOUNT,
          scope: PromotionScope.STORE,
          discountValue: input.promoDiscount,
          isActive: true,
        }),
      );
      tracked.promotionIds.push(promo.id);
      const usage = await promotionUsageRepo.save(
        promotionUsageRepo.create({
          promotionId: promo.id,
          orderId: order.id,
          discountAmount: input.promoDiscount,
        }),
      );
      tracked.promotionUsageIds.push(usage.id);
    }

    return order;
  }

  async function seedMixedCutoffUnpaid(store: Store, paymentMethod: PaymentMethod, label: string) {
    const catalog = await seedCatalog(store, label);
    await seedPaidOrder({
      store,
      productName: catalog.product.name,
      variant: catalog.variant,
      paymentMethod,
      paidAt: PRE_PAID_AT,
      itemSubtotal: 400,
      orderNumber: `SC-PRE-${label}-${seedContext.runId}`,
    });
    await seedPaidOrder({
      store,
      productName: catalog.product.name,
      variant: catalog.variant,
      paymentMethod,
      paidAt: POST_PAID_AT,
      itemSubtotal: 1100,
      orderNumber: `SC-POST-${label}-${seedContext.runId}`,
      shippingFee: 80,
      shippingOptionId: catalog.shippingOption.id,
      promoDiscount: 100,
    });
    return catalog;
  }

  // AC-001/002/007/008/010–013/017/021–023
  // Behavior: Store with commission_rate NULL + mixed unpaid set → payout create on Omise rail and
  // manual rail → same already-net amount; default 7% on post-cutoff product only; shipping
  // pass-through post-cutoff; pre-cutoff product at 0% with shipping excluded; one combined fours.
  // @category: core-functionality
  // @lane: integration
  // @dependency: PayoutsService, payout-commission.calculator, StoresService (read), PostgreSQL, ConfigService(goLiveAt, default 7)
  // @complexity: high
  // ROI: 120
  it('deducts default 7% on post-cutoff product only, passes shipping through, and writes the same already-net amount on both rails', async () => {
    if (skipWithoutPostgres()) {
      return;
    }

    const omiseStore = await seedStore('int1-omise', 'omise');
    const manualStore = await seedStore('int1-manual', 'manual');
    await seedMixedCutoffUnpaid(omiseStore, PaymentMethod.PROMPTPAY, 'omise');
    await seedMixedCutoffUnpaid(manualStore, PaymentMethod.BANK_TRANSFER, 'manual');
    omiseCreateTransfer.mockResolvedValue({ id: 'trsf_int1', paid: false });

    const gqlRes = await request(app!.getHttpServer())
      .post('/graphql')
      .send({
        query: TRIGGER_PAYOUT,
        variables: { input: { storeId: omiseStore.id } },
      })
      .expect(200);

    expect(gqlRes.body.errors).toBeUndefined();
    const omiseGql = gqlRes.body.data.triggerPayout;
    expect(omiseGql.amount).toBe(1410);
    expect(omiseGql.netAmount).toBe(1410);
    expect(omiseGql.productSold).toBe(1400);
    expect(omiseGql.shippingFees).toBe(80);
    expect(omiseGql.commissionAmount).toBe(70);
    expect(omiseGql.commissionRate).toBe(7);
    expect(omiseGql).not.toHaveProperty('pre_productSold');
    expect(omiseGql).not.toHaveProperty('post_productSold');
    tracked.payoutIds.push(omiseGql.id);

    const omiseRow = await payoutRepo.findOneByOrFail({ id: omiseGql.id });
    expect(Number(omiseRow.amount)).toBe(1410);
    expect(Number(omiseRow.netAmount)).toBe(1410);
    expect(Number(omiseRow.fee)).toBe(0);
    expect(Number(omiseRow.productSold)).toBe(1400);
    expect(Number(omiseRow.shippingFees)).toBe(80);
    expect(Number(omiseRow.commissionAmount)).toBe(70);
    expect(omiseRow.commissionRate).toBe(7);
    expect(omiseCreateTransfer).toHaveBeenCalledWith(omiseStore.omiseRecipientId, 141000);

    const listRes = await request(app!.getHttpServer())
      .post('/graphql')
      .send({ query: ADMIN_STORE_PAYOUTS, variables: { storeId: omiseStore.id } })
      .expect(200);
    expect(listRes.body.data.adminStorePayouts[0].amount).toBe(1410);

    const manual = await payoutsService.requestManualPayout(
      manualStore.id,
      '22222222-2222-4222-8222-222222222222',
    );
    tracked.payoutIds.push(manual.id);
    expect(Number(manual.amount)).toBe(1410);
    expect(Number(manual.netAmount)).toBe(1410);
    expect(Number(manual.fee)).toBe(0);
    expect(Number(manual.productSold)).toBe(1400);
    expect(Number(manual.shippingFees)).toBe(80);
    expect(Number(manual.commissionAmount)).toBe(70);
    expect(manual.commissionRate).toBe(7);

    const queueRes = await request(app!.getHttpServer())
      .post('/graphql')
      .send({ query: PENDING_MANUAL })
      .expect(200);
    const queued = queueRes.body.data.pendingManualPayouts.items.find(
      (row: { id: string }) => row.id === manual.id,
    );
    expect(queued.amount).toBe(1410);
    expect(queued.productSold).toBe(1400);
    expect(queued.commissionAmount).toBe(70);
  });
});

describe('store commission — admin rate edit and snapshot immutability [integration]', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let payoutsService: PayoutsService;
  let storesService: StoresService;
  let payoutRepo: Repository<Payout>;
  let storeRepo: Repository<Store>;
  let orderRepo: Repository<Order>;
  let orderItemRepo: Repository<OrderItem>;
  let variantRepo: Repository<ProductVariant>;
  let shippingOptionRepo: Repository<StoreShippingOption>;
  let storeShippingRepo: Repository<OrderStoreShipping>;
  let promotionRepo: Repository<Promotion>;
  let promotionUsageRepo: Repository<PromotionUsage>;

  const seedContext = createSeedRunContext(`store-commission-int2-${Date.now()}`);
  const tracked = {
    payoutIds: [] as string[],
    orderIds: [] as string[],
    itemIds: [] as string[],
    variantIds: [] as string[],
    shippingOptionIds: [] as string[],
    storeShippingIds: [] as string[],
    promotionIds: [] as string[],
    promotionUsageIds: [] as string[],
  };

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([
          Payout,
          Store,
          User,
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
      ],
      providers: [
        PayoutsService,
        StoresService,
        { provide: AuditLogsService, useValue: { log: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'payout.minPayoutAmount') return 500;
              if (key === 'commission.defaultRatePercent') return 7;
              if (key === 'commission.goLiveAt') return GO_LIVE_AT;
              return undefined;
            },
          },
        },
        {
          provide: OmiseService,
          useValue: {
            hasCredentials: jest.fn().mockReturnValue(false),
            createTransfer: jest.fn(),
            getRecipient: jest.fn(),
          },
        },
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
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    payoutsService = moduleFixture.get(PayoutsService);
    storesService = moduleFixture.get(StoresService);
    payoutRepo = moduleFixture.get(getRepositoryToken(Payout));
    storeRepo = moduleFixture.get(getRepositoryToken(Store));
    orderRepo = moduleFixture.get(getRepositoryToken(Order));
    orderItemRepo = moduleFixture.get(getRepositoryToken(OrderItem));
    variantRepo = moduleFixture.get(getRepositoryToken(ProductVariant));
    shippingOptionRepo = moduleFixture.get(getRepositoryToken(StoreShippingOption));
    storeShippingRepo = moduleFixture.get(getRepositoryToken(OrderStoreShipping));
    promotionRepo = moduleFixture.get(getRepositoryToken(Promotion));
    promotionUsageRepo = moduleFixture.get(getRepositoryToken(PromotionUsage));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupTracked();
      await cleanupSeedRun(dataSource, seedContext);
    }
    if (app) {
      await app.close();
    }
  });

  afterEach(async () => {
    if (dataSource?.isInitialized) {
      await cleanupTracked();
    }
  });

  async function cleanupTracked(): Promise<void> {
    if (tracked.payoutIds.length) {
      await payoutRepo.delete(tracked.payoutIds);
      tracked.payoutIds = [];
    }
    if (tracked.promotionUsageIds.length) {
      await promotionUsageRepo.delete(tracked.promotionUsageIds);
      tracked.promotionUsageIds = [];
    }
    if (tracked.promotionIds.length) {
      await promotionRepo.delete(tracked.promotionIds);
      tracked.promotionIds = [];
    }
    if (tracked.storeShippingIds.length) {
      await storeShippingRepo.delete(tracked.storeShippingIds);
      tracked.storeShippingIds = [];
    }
    if (tracked.itemIds.length) {
      await orderItemRepo.delete(tracked.itemIds);
      tracked.itemIds = [];
    }
    if (tracked.orderIds.length) {
      await orderRepo.delete(tracked.orderIds);
      tracked.orderIds = [];
    }
    if (tracked.shippingOptionIds.length) {
      await shippingOptionRepo.delete(tracked.shippingOptionIds);
      tracked.shippingOptionIds = [];
    }
    if (tracked.variantIds.length) {
      await variantRepo.delete(tracked.variantIds);
      tracked.variantIds = [];
    }
  }

  async function seedPostCutoffStore(suffix: string, postProduct: number): Promise<Store> {
    const owner = await createTestUser(dataSource, seedContext, {
      suffix: `${suffix}-owner`,
      role: UserRole.VENDOR,
    });
    const store = await createTestStore(dataSource, seedContext, {
      suffix,
      ownerId: owner.id,
      status: StoreStatus.APPROVED,
      approvedBy: owner.id,
    });
    const product = await createTestProduct(dataSource, seedContext, {
      suffix: `${suffix}-prod`,
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
    });
    const variant = await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: `SKU-SC2-${suffix}-${seedContext.runId}`.slice(0, 100),
        options: {},
        priceAdjustment: 0,
        stockQuantity: 20,
      }),
    );
    tracked.variantIds.push(variant.id);
    const order = await orderRepo.save(
      orderRepo.create({
        orderNumber: `SC2-${suffix}-${seedContext.runId}`.slice(0, 50),
        customerId: null,
        guestPhone: '+66812345678',
        guestName: 'INT2',
        status: OrderStatus.PAID,
        subtotal: postProduct,
        discountAmount: 0,
        shippingFee: 0,
        total: postProduct,
        paymentMethod: PaymentMethod.PROMPTPAY,
        paidAt: POST_PAID_AT,
      }),
    );
    tracked.orderIds.push(order.id);
    const item = await orderItemRepo.save(
      orderItemRepo.create({
        orderId: order.id,
        storeId: store.id,
        variantId: variant.id,
        productName: product.name,
        variantOptions: {},
        unitPrice: postProduct,
        quantity: 1,
        subtotal: postProduct,
        fulfillmentStatus: FulfillmentStatus.PENDING,
      }),
    );
    tracked.itemIds.push(item.id);
    return store;
  }

  // AC-003/018/019/028
  // @category: core-functionality
  // @lane: integration
  // ROI: 70
  it('persists a custom 0–100 rate for subsequent creates without rewriting a pending snapshot', async () => {
    if (!postgresAvailable) {
      return;
    }

    const store = await seedPostCutoffStore('int2-persist', 2000);
    const historicalStore = await seedPostCutoffStore('int2-hist', 100);
    const historical = await payoutRepo.save(
      payoutRepo.create({
        storeId: historicalStore.id,
        amount: 100,
        fee: 0,
        netAmount: 100,
        commissionRate: null,
        productSold: null,
        shippingFees: null,
        commissionAmount: null,
        status: PayoutStatus.COMPLETED,
        settlementRail: PayoutSettlementRail.OMISE,
      }),
    );
    tracked.payoutIds.push(historical.id);

    const pending = await payoutsService.triggerPayout(store.id, {
      amount: 930,
      bypassMinimum: true,
    });
    tracked.payoutIds.push(pending.id);
    const frozen = {
      amount: Number(pending.amount),
      netAmount: Number(pending.netAmount),
      productSold: Number(pending.productSold),
      shippingFees: Number(pending.shippingFees),
      commissionAmount: Number(pending.commissionAmount),
      commissionRate: pending.commissionRate,
    };
    expect(frozen).toEqual({
      amount: 930,
      netAmount: 930,
      productSold: 1000,
      shippingFees: 0,
      commissionAmount: 70,
      commissionRate: 7,
    });

    await storesService.updateAsAdmin({ id: store.id, commissionRate: 5 });
    const stored = await storeRepo.findOneByOrFail({ id: store.id });
    expect(stored.commissionRate).toBe(5);

    const reread = await payoutRepo.findOneByOrFail({ id: pending.id });
    expect(Number(reread.amount)).toBe(frozen.amount);
    expect(Number(reread.netAmount)).toBe(frozen.netAmount);
    expect(Number(reread.productSold)).toBe(frozen.productSold);
    expect(Number(reread.shippingFees)).toBe(frozen.shippingFees);
    expect(Number(reread.commissionAmount)).toBe(frozen.commissionAmount);
    expect(reread.commissionRate).toBe(frozen.commissionRate);

    const leftover = await payoutsService.getPayoutSummary(store.id);
    expect(leftover.productSold).toBe(1000);
    expect(leftover.commissionAmount).toBe(50);
    expect(leftover.commissionRate).toBe(5);
    expect(leftover.availableBalance).toBe(950);

    const histReread = await payoutRepo.findOneByOrFail({ id: historical.id });
    expect(histReread.commissionRate).toBeNull();
    expect(histReread.productSold).toBeNull();
    expect(histReread.shippingFees).toBeNull();
    expect(histReread.commissionAmount).toBeNull();
  });

  // AC-006
  // @category: core-functionality
  // @lane: integration
  // ROI: 70
  it('rejects out-of-range rates and persists 0 as an explicit custom no take-rate', async () => {
    if (!postgresAvailable) {
      return;
    }

    const store = await seedPostCutoffStore('int2-reject', 1000);
    await storesService.updateAsAdmin({ id: store.id, commissionRate: 5 });

    await expect(
      storesService.updateAsAdmin({ id: store.id, commissionRate: 101 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_COMMISSION_RATE' } });
    await expect(
      storesService.updateAsAdmin({ id: store.id, commissionRate: 7.5 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_COMMISSION_RATE' } });
    await expect(
      storesService.updateAsAdmin({ id: store.id, commissionRate: -1 }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_COMMISSION_RATE' } });
    expect((await storeRepo.findOneByOrFail({ id: store.id })).commissionRate).toBe(5);

    await storesService.updateAsAdmin({ id: store.id, commissionRate: 0 });
    expect((await storeRepo.findOneByOrFail({ id: store.id })).commissionRate).toBe(0);

    const summary = await payoutsService.getPayoutSummary(store.id);
    expect(summary.commissionRate).toBe(0);
    expect(summary.commissionAmount).toBe(0);
    expect(summary.availableBalance).toBe(1000);
  });
});
