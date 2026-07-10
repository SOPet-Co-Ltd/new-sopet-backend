import 'reflect-metadata';
import { OrdersResolver } from './orders.resolver';
import { OrdersService } from './orders.service';
import { ProductsService } from '../products/products.service';
import { StoresService } from '../stores/stores.service';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';

function buildOrderFixture(overrides: Partial<Order> = {}): Order {
  const createdAt = new Date('2024-06-15T10:30:00.000Z');

  return {
    id: 'order-1',
    orderNumber: 'ORD-TEST-001',
    customerId: 'cust-1',
    guestPhone: null,
    guestName: null,
    guestEmail: null,
    status: OrderStatus.PAID,
    subtotal: 500,
    discountAmount: 0,
    shippingFee: 80,
    total: 580,
    paymentMethod: PaymentMethod.PROMPTPAY,
    paymentReference: null,
    paidAt: null,
    notes: null,
    createdAt,
    updatedAt: createdAt,
    items: [
      {
        id: 'item-1',
        orderId: 'order-1',
        storeId: 'store-1',
        variantId: 'variant-1',
        productName: 'Dog Food',
        variantOptions: {},
        unitPrice: 250,
        quantity: 2,
        subtotal: 500,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        trackingNumber: null,
        shippedAt: null,
        deliveredAt: null,
        createdAt,
        updatedAt: createdAt,
      },
    ],
    storeShippings: [
      {
        id: 'oss-1',
        orderId: 'order-1',
        storeId: 'store-1',
        shippingOptionId: 'ship-opt-1',
        optionName: 'Standard Delivery',
        shippingFee: 50,
        createdAt,
      },
      {
        id: 'oss-2',
        orderId: 'order-1',
        storeId: 'store-2',
        shippingOptionId: 'ship-opt-2',
        optionName: 'Express',
        shippingFee: 30,
        createdAt,
      },
    ],
    shippingAddress: {
      id: 'addr-1',
      orderId: 'order-1',
      savedAddressId: null,
      fullName: 'Test User',
      phone: '0812345678',
      addressLine1: '123 Main St',
      addressLine2: null,
      tumbon: null,
      amphoe: 'Bang Kapi',
      province: 'Bangkok',
      postalCode: '10240',
      createdAt,
    },
    ...overrides,
  } as Order;
}

describe('OrdersResolver mapOrder extensions', () => {
  let ordersService: jest.Mocked<
    Pick<
      OrdersService,
      | 'findOne'
      | 'findByCustomer'
      | 'findByCustomerPaginated'
      | 'findByGuestPhone'
      | 'findByStore'
      | 'findLatestPurchaseProductId'
      | 'findLatestPurchaseProductIds'
      | 'findOneWithItems'
      | 'create'
      | 'updateStatus'
    >
  >;
  let productsService: jest.Mocked<
    Pick<ProductsService, 'findOnePublished' | 'findPublishedByIds'>
  >;
  let storesService: jest.Mocked<Pick<StoresService, 'assertStoreOwner' | 'getAccessibleStores'>>;
  let resolver: OrdersResolver;

  beforeEach(() => {
    ordersService = {
      findOne: jest.fn(),
      findByCustomer: jest.fn(),
      findByCustomerPaginated: jest.fn(),
      findByGuestPhone: jest.fn(),
      findByStore: jest.fn(),
      findLatestPurchaseProductId: jest.fn(),
      findLatestPurchaseProductIds: jest.fn(),
      findOneWithItems: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    productsService = {
      findOnePublished: jest.fn(),
      findPublishedByIds: jest.fn(),
    };
    storesService = {
      assertStoreOwner: jest.fn(),
      getAccessibleStores: jest.fn(),
    };
    resolver = new OrdersResolver(
      ordersService as unknown as OrdersService,
      productsService as unknown as ProductsService,
      storesService as unknown as StoresService,
    );
  });

  describe('order(id:)', () => {
    it('returns createdAt as ISO-8601 DateTime', async () => {
      const createdAt = new Date('2024-06-15T10:30:00.000Z');
      ordersService.findOne.mockResolvedValue(buildOrderFixture({ createdAt }));

      const result = await resolver.order('order-1', 'cust-1');

      expect(result.createdAt).toEqual(createdAt);
      expect(result.createdAt.toISOString()).toBe('2024-06-15T10:30:00.000Z');
    });

    it('returns storeShippings with storeId, optionName, and shippingFee', async () => {
      ordersService.findOne.mockResolvedValue(buildOrderFixture());

      const result = await resolver.order('order-1', 'cust-1');

      expect(result.storeShippings).toEqual([
        { storeId: 'store-1', optionName: 'Standard Delivery', shippingFee: 50 },
        { storeId: 'store-2', optionName: 'Express', shippingFee: 30 },
      ]);
    });

    it('returns variantId on each OrderItemType', async () => {
      ordersService.findOne.mockResolvedValue(buildOrderFixture());

      const result = await resolver.order('order-1', 'cust-1');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].variantId).toBe('variant-1');
    });

    it('returns empty storeShippings array when order has none', async () => {
      ordersService.findOne.mockResolvedValue(buildOrderFixture({ storeShippings: [] }));

      const result = await resolver.order('order-1', 'cust-1');

      expect(result.storeShippings).toEqual([]);
    });
  });

  describe('orders', () => {
    it('returns paginated customer order list with extended fields', async () => {
      ordersService.findByCustomerPaginated.mockResolvedValue({
        items: [buildOrderFixture()],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      const result = await resolver.orders('cust-1', 1, 10);

      expect(ordersService.findByCustomerPaginated).toHaveBeenCalledWith('cust-1', {
        page: 1,
        limit: 10,
        filter: undefined,
      });
      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
      expect(result.items[0].createdAt).toEqual(new Date('2024-06-15T10:30:00.000Z'));
      expect(result.items[0].storeShippings).toHaveLength(2);
      expect(result.items[0].items[0].variantId).toBe('variant-1');
    });
  });

  describe('guestOrders', () => {
    it('returns extended fields on guest order list', async () => {
      ordersService.findByGuestPhone.mockResolvedValue([
        buildOrderFixture({ guestPhone: '0812345678', customerId: null }),
      ]);

      const result = await resolver.guestOrders('0812345678');

      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBeInstanceOf(Date);
      expect(result[0].storeShippings).toHaveLength(2);
      expect(result[0].items[0].variantId).toBe('variant-1');
    });
  });
});
