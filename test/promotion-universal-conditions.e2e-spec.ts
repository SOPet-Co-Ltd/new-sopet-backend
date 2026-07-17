// Promotion Universal Conditions [service-integration-e2e]
// Promoted from test/promotion-universal-conditions.service.e2e.test.ts (backend-task-08)
// Design Doc: promotion-universal-conditions-backend-design.md
// Related ACs: AC-003 create path, AC-035, AC-037/I001c, AC-021
//
// @real-dependency: PostgreSQL, TypeORM (promotions, customers, orders, products, promotion_usages)
// Mock: Omise / Redis / Notifications / Cart / Inventory restore (COD path only)

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { GuestOrderLinkService } from '../src/modules/orders/guest-order-link.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { CartService } from '../src/modules/cart/cart.service';
import { Order } from '../src/database/entities/order.entity';
import { OrderItem } from '../src/database/entities/order-item.entity';
import { OrderShippingAddress } from '../src/database/entities/order-shipping-address.entity';
import { OrderStoreShipping } from '../src/database/entities/order-store-shipping.entity';
import { OrderStatusHistory } from '../src/database/entities/order-status-history.entity';
import { SavedAddress } from '../src/database/entities/saved-address.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { StoreShippingOption } from '../src/database/entities/store-shipping-option.entity';
import { Store, StoreStatus } from '../src/database/entities/store.entity';
import { UserRole } from '../src/database/entities/user.entity';
import { Customer } from '../src/database/entities/customer.entity';
import {
  Promotion,
  PromotionScope,
  PromotionType,
} from '../src/database/entities/promotion.entity';
import { PromotionUsage } from '../src/database/entities/promotion-usage.entity';
import { InventoryTransaction } from '../src/database/entities/inventory-transaction.entity';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestUser,
  isPostgresAvailable,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

const UNIT_PRICE = 100;
const SHIPPING_ADDRESS = {
  recipientName: 'E2E Promo Customer',
  recipientPhone: '0812345678',
  addressLine1: '1 Promo Rd',
  amphoe: 'Pathumwan',
  province: 'Bangkok',
  postalCode: '10330',
};

describe('Promotion universal conditions createOrder (service-integration-e2e)', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let promotionsService: PromotionsService;
  let orderRepo: Repository<Order>;
  let orderItemRepo: Repository<OrderItem>;
  let usageRepo: Repository<PromotionUsage>;
  let promotionRepo: Repository<Promotion>;
  let customerRepo: Repository<Customer>;
  let variantRepo: Repository<ProductVariant>;

  const seedContext = createSeedRunContext(`promo-uc-${Date.now()}`);
  const tracked = {
    customerIds: [] as string[],
    promotionIds: [] as string[],
    variantIds: [] as string[],
    orderIds: [] as string[],
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
          Order,
          OrderItem,
          OrderShippingAddress,
          OrderStoreShipping,
          OrderStatusHistory,
          SavedAddress,
          ProductVariant,
          Product,
          StoreShippingOption,
          Store,
          Promotion,
          PromotionUsage,
          Customer,
          InventoryTransaction,
        ]),
      ],
      providers: [
        OrdersService,
        PromotionsService,
        {
          provide: NotificationsService,
          useValue: {
            notifyVendorsAboutNewOrder: jest.fn().mockResolvedValue(undefined),
            notifyOrderStatusChanged: jest.fn(),
            notifyVendorAboutNewOrder: jest.fn(),
            notifyVendorsAboutOrderStatus: jest.fn(),
          },
        },
        { provide: GuestOrderLinkService, useValue: { mergeGuestOrders: jest.fn() } },
        { provide: InventoryService, useValue: { restoreOrderStock: jest.fn() } },
        { provide: CartService, useValue: { removeItems: jest.fn() } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    ordersService = moduleFixture.get(OrdersService);
    promotionsService = moduleFixture.get(PromotionsService);
    orderRepo = moduleFixture.get(getRepositoryToken(Order));
    orderItemRepo = moduleFixture.get(getRepositoryToken(OrderItem));
    usageRepo = moduleFixture.get(getRepositoryToken(PromotionUsage));
    promotionRepo = moduleFixture.get(getRepositoryToken(Promotion));
    customerRepo = moduleFixture.get(getRepositoryToken(Customer));
    variantRepo = moduleFixture.get(getRepositoryToken(ProductVariant));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupPromoRun();
      await cleanupSeedRun(dataSource, seedContext);
    }
    if (app) {
      await app.close();
    }
  });

  async function cleanupPromoRun(): Promise<void> {
    if (tracked.orderIds.length) {
      await dataSource.query(`DELETE FROM promotion_usages WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await dataSource.query(
        `DELETE FROM inventory_transactions WHERE reference_id = ANY($1::uuid[])`,
        [tracked.orderIds],
      );
      await dataSource.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await dataSource.query(`DELETE FROM order_status_history WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await dataSource.query(
        `DELETE FROM order_shipping_addresses WHERE order_id = ANY($1::uuid[])`,
        [tracked.orderIds],
      );
      await dataSource.query(`DELETE FROM order_store_shippings WHERE order_id = ANY($1::uuid[])`, [
        tracked.orderIds,
      ]);
      await orderRepo.delete(tracked.orderIds);
    }
    if (tracked.promotionIds.length) {
      await promotionRepo.delete(tracked.promotionIds);
    }
    if (tracked.variantIds.length) {
      await variantRepo.delete(tracked.variantIds);
    }
    if (tracked.customerIds.length) {
      await customerRepo.delete(tracked.customerIds);
    }
  }

  const itWhenPostgres = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!postgresAvailable) {
        console.warn('Skipping: PostgreSQL not available for promotion-universal-conditions e2e');
        return;
      }
      await fn();
    });
  };

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
      suffix: `bxgy-product-${label}`,
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `BxGy Product ${label} ${seedContext.runId}`,
    });
    const variant = await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: `SKU-${label}-${seedContext.runId}`.slice(0, 100),
        options: { size: 'default' },
        priceAdjustment: 0,
        stockQuantity: 100,
      }),
    );
    tracked.variantIds.push(variant.id);
    return { store, product, variant };
  }

  async function seedCustomer(phoneSuffix: string): Promise<Customer> {
    const phone = `08${phoneSuffix}`.slice(0, 10);
    const customer = await customerRepo.save(
      customerRepo.create({
        phone,
        fullName: `Promo E2E ${phoneSuffix}`,
        isVerified: true,
        isActive: true,
      }),
    );
    tracked.customerIds.push(customer.id);
    return customer;
  }

  async function seedPromotion(input: {
    code: string;
    type: PromotionType;
    scope: PromotionScope;
    storeId?: string | null;
    discountValue?: number;
    conditions?: Record<string, unknown>;
  }): Promise<Promotion> {
    const promotion = await promotionRepo.save(
      promotionRepo.create({
        code: input.code,
        name: `E2E ${input.code}`,
        type: input.type,
        scope: input.scope,
        storeId: input.storeId ?? null,
        discountValue: input.discountValue ?? 0,
        usagePerCustomer: 0,
        usageCount: 0,
        isActive: true,
        conditions: input.conditions ?? {},
      }),
    );
    tracked.promotionIds.push(promotion.id);
    return promotion;
  }

  function orderItems(
    product: Product,
    variant: ProductVariant,
    quantity: number,
  ): Array<{ productId: string; variantId: string; quantity: number; price: number }> {
    return [
      {
        productId: product.id,
        variantId: variant.id,
        quantity,
        price: UNIT_PRICE,
      },
    ];
  }

  itWhenPostgres(
    '(1) AC-003: guest createOrder with newCustomer-conditioned promo throws GUEST and persists no order',
    async () => {
      const { product, variant } = await seedCatalog('guest');
      const guestCode = `GUESTNC-${seedContext.runId}`.slice(0, 50);
      await seedPromotion({
        code: guestCode,
        type: PromotionType.PERCENTAGE,
        scope: PromotionScope.PLATFORM,
        discountValue: 10,
        conditions: { newCustomer: { enabled: true, nDays: 7 } },
      });

      const ordersBefore = await orderRepo.count();

      await expect(
        ordersService.create(
          {
            items: orderItems(product, variant, 1),
            paymentMethod: 'cod',
            guestPhone: '0899998888',
            platformPromotionCode: guestCode,
            shippingAddress: SHIPPING_ADDRESS,
          },
          undefined,
        ),
      ).rejects.toMatchObject({
        response: { code: 'GUEST' },
      });

      expect(await orderRepo.count()).toBe(ordersBefore);
    },
  );

  itWhenPostgres(
    '(2)/(3)/(ADR-3): eligible customer Buy2Get1 Q=3 + FIXED — usage from stacked map; preview agrees; no free lines',
    async () => {
      const { store, product, variant } = await seedCatalog('eligible');
      const customer = await seedCustomer(`${Date.now()}`.slice(-8));

      const fixedCode = `FIX50-${seedContext.runId}`.slice(0, 50);
      const bxgyCode = `BXGY3-${seedContext.runId}`.slice(0, 50);

      const fixedPromo = await seedPromotion({
        code: fixedCode,
        type: PromotionType.FIXED_AMOUNT,
        scope: PromotionScope.PLATFORM,
        discountValue: 50,
      });
      const bxgyPromo = await seedPromotion({
        code: bxgyCode,
        type: PromotionType.BUY_X_GET_Y,
        scope: PromotionScope.STORE,
        storeId: store.id,
        discountValue: 0,
        conditions: {
          productId: product.id,
          buyQuantity: 2,
          getQuantity: 1,
          newCustomer: { enabled: true, nDays: 30 },
        },
      });

      const quantity = 3;
      const subtotal = UNIT_PRICE * quantity;
      // Rule B: freeUnits=1 → cheapest unit = UNIT_PRICE
      const expectedBxGyDiscount = UNIT_PRICE;
      const expectedFixedDiscount = 50;
      const expectedTotalDiscount = expectedFixedDiscount + expectedBxGyDiscount;

      const previewFixed = await promotionsService.validateCode(
        fixedCode,
        subtotal,
        undefined,
        { customerId: customer.id },
        {
          mode: 'preview',
          lines: [
            {
              productId: product.id,
              variantId: variant.id,
              quantity,
              unitPrice: UNIT_PRICE,
              storeId: store.id,
            },
          ],
        },
      );
      const previewBxGy = await promotionsService.validateCode(
        bxgyCode,
        subtotal,
        store.id,
        { customerId: customer.id },
        {
          mode: 'preview',
          lines: [
            {
              productId: product.id,
              variantId: variant.id,
              quantity,
              unitPrice: UNIT_PRICE,
              storeId: store.id,
            },
          ],
        },
      );

      expect(previewFixed.ineligibilityReason).toBeNull();
      expect(previewFixed.discountAmount).toBe(expectedFixedDiscount);
      expect(previewBxGy.ineligibilityReason).toBeNull();
      expect(previewBxGy.freeUnits).toBe(1);
      expect(previewBxGy.discountAmount).toBe(expectedBxGyDiscount);

      const order = await ordersService.create(
        {
          items: orderItems(product, variant, quantity),
          paymentMethod: 'cod',
          platformPromotionCode: fixedCode,
          storePromotionCodes: [bxgyCode],
          shippingAddress: SHIPPING_ADDRESS,
        },
        customer.id,
      );
      tracked.orderIds.push(order.id);

      expect(Number(order.discountAmount)).toBe(expectedTotalDiscount);
      expect(Number(order.discountAmount)).toBe(
        Number(previewFixed.discountAmount) + Number(previewBxGy.discountAmount),
      );

      const usages = await usageRepo.find({ where: { orderId: order.id } });
      expect(usages).toHaveLength(2);

      const fixedUsage = usages.find((u) => u.promotionId === fixedPromo.id);
      const bxgyUsage = usages.find((u) => u.promotionId === bxgyPromo.id);
      expect(Number(fixedUsage?.discountAmount)).toBe(expectedFixedDiscount);
      expect(Number(bxgyUsage?.discountAmount)).toBe(expectedBxGyDiscount);

      const items = await orderItemRepo.find({ where: { orderId: order.id } });
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(quantity);
      expect(Number(items[0].unitPrice)).toBe(UNIT_PRICE);
      // ADR Decision 3: no free-line markers / auto-added free SKUs
      expect(Object.keys(items[0]).some((k) => /free/i.test(k))).toBe(false);
    },
  );

  itWhenPostgres(
    '(4) AC-037/I001c: BxGy Q=2 (freeUnits=0) createOrder succeeds without that promo discount and without throw',
    async () => {
      const { store, product, variant } = await seedCatalog('skip-q2');
      const customer = await seedCustomer(`${Date.now() + 1}`.slice(-8));

      const bxgyCode = `BXGY2-${seedContext.runId}`.slice(0, 50);
      const bxgyPromo = await seedPromotion({
        code: bxgyCode,
        type: PromotionType.BUY_X_GET_Y,
        scope: PromotionScope.STORE,
        storeId: store.id,
        discountValue: 0,
        conditions: {
          productId: product.id,
          buyQuantity: 2,
          getQuantity: 1,
        },
      });

      const quantity = 2;
      const order = await ordersService.create(
        {
          items: orderItems(product, variant, quantity),
          paymentMethod: 'cod',
          storePromotionCodes: [bxgyCode],
          shippingAddress: SHIPPING_ADDRESS,
        },
        customer.id,
      );
      tracked.orderIds.push(order.id);

      expect(Number(order.discountAmount)).toBe(0);
      const usages = await usageRepo.find({ where: { orderId: order.id } });
      expect(usages.filter((u) => u.promotionId === bxgyPromo.id)).toHaveLength(0);

      const items = await orderItemRepo.find({ where: { orderId: order.id } });
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(quantity);
    },
  );
});
