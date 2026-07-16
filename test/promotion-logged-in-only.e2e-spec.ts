// Promotion Logged-In Only [service-integration-e2e]
// Promoted from test/promotion-logged-in-only.service.e2e.test.ts (backend-task-04)
// Design Doc: promotion-logged-in-only-backend-design.md
// Related ACs: AC-005 create path, AC-006, AC-021
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
import { Order, OrderStatus, PaymentMethod } from '../src/database/entities/order.entity';
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
const DISCOUNT_PERCENT = 10;
const EXPECTED_DISCOUNT = UNIT_PRICE * (DISCOUNT_PERCENT / 100);
const SHIPPING_ADDRESS = {
  recipientName: 'E2E LoggedInOnly Customer',
  recipientPhone: '0812345678',
  addressLine1: '1 Members Rd',
  amphoe: 'Pathumwan',
  province: 'Bangkok',
  postalCode: '10330',
};

describe('Promotion loggedInOnly createOrder (service-integration-e2e)', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let ordersService: OrdersService;
  let orderRepo: Repository<Order>;
  let usageRepo: Repository<PromotionUsage>;
  let promotionRepo: Repository<Promotion>;
  let customerRepo: Repository<Customer>;
  let variantRepo: Repository<ProductVariant>;

  const seedContext = createSeedRunContext(`promo-lio-${Date.now()}`);
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
    orderRepo = moduleFixture.get(getRepositoryToken(Order));
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
        console.warn('Skipping: PostgreSQL not available for promotion-logged-in-only e2e');
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
      suffix: `lio-product-${label}`,
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `LoggedInOnly Product ${label} ${seedContext.runId}`,
    });
    const variant = await variantRepo.save(
      variantRepo.create({
        productId: product.id,
        sku: `SKU-LIO-${label}-${seedContext.runId}`.slice(0, 100),
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
        fullName: `LIO E2E ${phoneSuffix}`,
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

  /** Prior paid-path order so customer would fail newCustomer ORDER_HISTORY if that gate were on. */
  async function seedPriorPaidOrder(customerId: string): Promise<Order> {
    const prior = await orderRepo.save(
      orderRepo.create({
        orderNumber: `PRIOR-LIO-${seedContext.runId}-${Date.now()}`.slice(0, 50),
        customerId,
        status: OrderStatus.PAID,
        subtotal: 50,
        discountAmount: 0,
        shippingFee: 0,
        total: 50,
        paymentMethod: PaymentMethod.COD,
        paidAt: new Date(),
      }),
    );
    tracked.orderIds.push(prior.id);
    return prior;
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
    '(1) AC-005: guest createOrder with loggedInOnly promo throws GUEST and persists no order',
    async () => {
      const { product, variant } = await seedCatalog('guest');
      const guestCode = `LIOGUEST-${seedContext.runId}`.slice(0, 50);
      await seedPromotion({
        code: guestCode,
        type: PromotionType.PERCENTAGE,
        scope: PromotionScope.PLATFORM,
        discountValue: DISCOUNT_PERCENT,
        conditions: { loggedInOnly: { enabled: true } },
      });

      const ordersBefore = await orderRepo.count();

      await expect(
        ordersService.create(
          {
            items: orderItems(product, variant, 1),
            paymentMethod: 'cod',
            guestPhone: '0899997777',
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
    '(2) AC-006/AC-021: returning customer + only-loggedInOnly applies discount and persists promotion_usages',
    async () => {
      const { product, variant } = await seedCatalog('returning');
      const customer = await seedCustomer(`${Date.now()}`.slice(-8));
      await seedPriorPaidOrder(customer.id);

      const memberCode = `LIOMEM-${seedContext.runId}`.slice(0, 50);
      const promo = await seedPromotion({
        code: memberCode,
        type: PromotionType.PERCENTAGE,
        scope: PromotionScope.PLATFORM,
        discountValue: DISCOUNT_PERCENT,
        conditions: { loggedInOnly: { enabled: true } },
      });

      const order = await ordersService.create(
        {
          items: orderItems(product, variant, 1),
          paymentMethod: 'cod',
          platformPromotionCode: memberCode,
          shippingAddress: SHIPPING_ADDRESS,
        },
        customer.id,
      );
      tracked.orderIds.push(order.id);

      expect(Number(order.discountAmount)).toBe(EXPECTED_DISCOUNT);

      const usages = await usageRepo.find({ where: { orderId: order.id } });
      expect(usages).toHaveLength(1);
      expect(usages[0].promotionId).toBe(promo.id);
      expect(Number(usages[0].discountAmount)).toBe(EXPECTED_DISCOUNT);
    },
  );

  itWhenPostgres(
    '(3) Reference contract: guestPhone-only createOrder with loggedInOnly throws GUEST (never authenticates)',
    async () => {
      const { product, variant } = await seedCatalog('guestphone');
      const phoneCode = `LIOPHONE-${seedContext.runId}`.slice(0, 50);
      await seedPromotion({
        code: phoneCode,
        type: PromotionType.PERCENTAGE,
        scope: PromotionScope.PLATFORM,
        discountValue: DISCOUNT_PERCENT,
        conditions: { loggedInOnly: { enabled: true } },
      });

      const ordersBefore = await orderRepo.count();

      await expect(
        ordersService.create(
          {
            items: orderItems(product, variant, 1),
            paymentMethod: 'cod',
            guestPhone: '0888886666',
            platformPromotionCode: phoneCode,
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
});
