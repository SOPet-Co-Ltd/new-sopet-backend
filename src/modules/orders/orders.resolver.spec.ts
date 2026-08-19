import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { OrdersResolver } from './orders.resolver';
import { OrdersService } from './orders.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { PaymentsService } from '../payments/payments.service';
import { ProductsService } from '../products/products.service';
import { StoresService } from '../stores/stores.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import * as OrderMapper from './order.mapper';

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
      | 'findByStore'
      | 'findPendingBankTransferOrders'
      | 'findLatestPurchaseProductId'
      | 'findLatestPurchaseProductIds'
      | 'findOneWithItems'
      | 'findByOrderNumber'
      | 'create'
      | 'updateStatus'
    >
  >;
  let productsService: jest.Mocked<
    Pick<ProductsService, 'findOnePublished' | 'findPublishedByIds'>
  >;
  let storesService: jest.Mocked<
    Pick<StoresService, 'assertStoreAccess' | 'assertStoreOwner' | 'getAccessibleStores'>
  >;
  let orderFulfillmentService: jest.Mocked<
    Pick<
      OrderFulfillmentService,
      | 'markVendorOrderPaid'
      | 'acknowledgeVendorOrder'
      | 'shipVendorOrder'
      | 'cancelVendorOrder'
      | 'confirmOrderDelivered'
    >
  >;
  let paymentsService: jest.Mocked<
    Pick<PaymentsService, 'confirmBankTransferPaid' | 'getBankTransferDetails'>
  >;
  let resolver: OrdersResolver;

  beforeEach(() => {
    ordersService = {
      findOne: jest.fn(),
      findByCustomer: jest.fn(),
      findByCustomerPaginated: jest.fn(),
      findByStore: jest.fn(),
      findPendingBankTransferOrders: jest.fn(),
      findLatestPurchaseProductId: jest.fn(),
      findLatestPurchaseProductIds: jest.fn(),
      findOneWithItems: jest.fn(),
      findByOrderNumber: jest.fn(),
      create: jest.fn(),
      updateStatus: jest.fn(),
    };
    productsService = {
      findOnePublished: jest.fn(),
      findPublishedByIds: jest.fn(),
    };
    storesService = {
      assertStoreAccess: jest.fn().mockResolvedValue(undefined),
      assertStoreOwner: jest.fn(),
      getAccessibleStores: jest.fn(),
    };
    orderFulfillmentService = {
      markVendorOrderPaid: jest.fn(),
      acknowledgeVendorOrder: jest.fn(),
      shipVendorOrder: jest.fn(),
      cancelVendorOrder: jest.fn(),
      confirmOrderDelivered: jest.fn(),
    };
    paymentsService = {
      confirmBankTransferPaid: jest.fn(),
      getBankTransferDetails: jest.fn(),
    };
    resolver = new OrdersResolver(
      ordersService as unknown as OrdersService,
      orderFulfillmentService as unknown as OrderFulfillmentService,
      paymentsService as unknown as PaymentsService,
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

    it('returns productId and productImageUrl when variant relation is loaded', async () => {
      ordersService.findOne.mockResolvedValue(
        buildOrderFixture({
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
              fulfillmentProvider: null,
              trackingUrl: null,
              shippedAt: null,
              deliveredAt: null,
              createdAt: new Date('2024-06-15T10:30:00.000Z'),
              updatedAt: new Date('2024-06-15T10:30:00.000Z'),
              productVariant: {
                productId: 'prod-1',
                imageUrl: 'https://example.com/variant.jpg',
                product: {
                  images: [{ url: 'https://example.com/product.jpg', isThumbnail: true }],
                },
              },
            } as Order['items'][number],
          ],
        }),
      );

      const result = await resolver.order('order-1', 'cust-1');

      expect(result.items[0].productId).toBe('prod-1');
      expect(result.items[0].productImageUrl).toBe('https://example.com/variant.jpg');
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

  describe('orderTracking', () => {
    const PII_KEYS = [
      'id',
      'customerId',
      'guestPhone',
      'guestName',
      'guestEmail',
      'shippingAddress',
      'paymentMethod',
      'paymentReference',
      'notes',
      'paidAt',
    ] as const;

    it('is decorated with @Public()', () => {
      const orderTrackingMethod = Object.getOwnPropertyDescriptor(
        OrdersResolver.prototype,
        'orderTracking',
      )?.value as ((...args: unknown[]) => unknown) | undefined;

      expect(orderTrackingMethod).toBeDefined();

      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, orderTrackingMethod!) as
        boolean | undefined;
      expect(isPublic).toBe(true);
    });

    it('returns mapped tracking fields without PII for a PII-rich entity', async () => {
      ordersService.findByOrderNumber.mockResolvedValue(
        buildOrderFixture({
          guestPhone: '0812345678',
          guestName: 'Guest User',
          guestEmail: 'guest@example.com',
        }),
      );

      const result = await resolver.orderTracking('ORD-TEST-001');

      expect(ordersService.findByOrderNumber).toHaveBeenCalledWith('ORD-TEST-001');
      expect(result.orderNumber).toBe('ORD-TEST-001');
      expect(result.status).toBe(OrderStatus.PAID);
      expect(result.createdAt).toEqual(new Date('2024-06-15T10:30:00.000Z'));
      expect(result.subtotal).toBe(500);
      expect(result.shippingFee).toBe(80);
      expect(result.discountAmount).toBe(0);
      expect(result.total).toBe(580);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].productName).toBe('Dog Food');
      expect(result.storeShippings).toEqual([
        { storeId: 'store-1', optionName: 'Standard Delivery', shippingFee: 50 },
        { storeId: 'store-2', optionName: 'Express', shippingFee: 30 },
      ]);

      for (const key of PII_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it('trims orderNumber before lookup', async () => {
      ordersService.findByOrderNumber.mockResolvedValue(buildOrderFixture());

      await resolver.orderTracking('  ORD-TEST-001  ');

      expect(ordersService.findByOrderNumber).toHaveBeenCalledWith('ORD-TEST-001');
    });

    it('propagates NotFoundException from service', async () => {
      ordersService.findByOrderNumber.mockRejectedValue(
        new NotFoundException({
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
        }),
      );

      await expect(resolver.orderTracking('ORD-MISSING')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_FOUND' },
      });
    });

    it('does not invoke mapOrder', async () => {
      const mapOrderSpy = jest.spyOn(OrderMapper, 'mapOrder');
      ordersService.findByOrderNumber.mockResolvedValue(buildOrderFixture());

      await resolver.orderTracking('ORD-TEST-001');

      expect(mapOrderSpy).not.toHaveBeenCalled();
      mapOrderSpy.mockRestore();
    });
  });

  describe('confirmGuestOrderDelivered', () => {
    const PII_KEYS = [
      'id',
      'customerId',
      'guestPhone',
      'guestName',
      'guestEmail',
      'shippingAddress',
      'paymentMethod',
      'paymentReference',
      'notes',
      'paidAt',
    ] as const;

    it('returns mapOrderTracking without PII', async () => {
      const deliveredOrder = buildOrderFixture({
        status: OrderStatus.DELIVERED,
        guestPhone: '0812345678',
        guestName: 'Guest User',
        guestEmail: 'guest@example.com',
      });
      orderFulfillmentService.confirmOrderDelivered.mockResolvedValue(deliveredOrder);

      const result = await resolver.confirmGuestOrderDelivered({
        orderId: 'order-1',
        guestPhone: '+66812345678',
      });

      expect(orderFulfillmentService.confirmOrderDelivered).toHaveBeenCalledWith(
        'order-1',
        undefined,
        '+66812345678',
      );
      expect(result.orderNumber).toBe('ORD-TEST-001');
      expect(result.status).toBe(OrderStatus.DELIVERED);
      for (const key of PII_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });

    it('does not invoke mapOrder', async () => {
      const mapOrderSpy = jest.spyOn(OrderMapper, 'mapOrder');
      orderFulfillmentService.confirmOrderDelivered.mockResolvedValue(buildOrderFixture());

      await resolver.confirmGuestOrderDelivered({
        orderId: 'order-1',
        guestPhone: '0812345678',
      });

      expect(mapOrderSpy).not.toHaveBeenCalled();
      mapOrderSpy.mockRestore();
    });
  });

  describe('vendor order fulfillment mutations', () => {
    const order = buildOrderFixture();

    beforeEach(() => {
      orderFulfillmentService.markVendorOrderPaid.mockResolvedValue(order);
      orderFulfillmentService.acknowledgeVendorOrder.mockResolvedValue(order);
      orderFulfillmentService.shipVendorOrder.mockResolvedValue(order);
      orderFulfillmentService.cancelVendorOrder.mockResolvedValue(order);
    });

    it('markVendorOrderPaid allows any store member via assertStoreAccess', async () => {
      await resolver.markVendorOrderPaid('order-1', 'staff-1', 'store-1');

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('staff-1', 'store-1');
      expect(storesService.assertStoreOwner).not.toHaveBeenCalled();
      expect(orderFulfillmentService.markVendorOrderPaid).toHaveBeenCalledWith(
        'staff-1',
        'store-1',
        'order-1',
      );
    });

    it('acknowledgeVendorOrder allows any store member via assertStoreAccess', async () => {
      await resolver.acknowledgeVendorOrder('order-1', 'manager-1', 'store-1');

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('manager-1', 'store-1');
      expect(storesService.assertStoreOwner).not.toHaveBeenCalled();
      expect(orderFulfillmentService.acknowledgeVendorOrder).toHaveBeenCalledWith(
        'manager-1',
        'store-1',
        'order-1',
      );
    });

    it('shipVendorOrder allows any store member via assertStoreAccess', async () => {
      await resolver.shipVendorOrder(
        {
          orderId: 'order-1',
          trackingNumber: 'TH123',
          fulfillmentProvider: 'kerry',
          trackingUrl: null,
        },
        'staff-1',
        'store-1',
      );

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('staff-1', 'store-1');
      expect(storesService.assertStoreOwner).not.toHaveBeenCalled();
      expect(orderFulfillmentService.shipVendorOrder).toHaveBeenCalledWith(
        'staff-1',
        'store-1',
        'order-1',
        'TH123',
        'kerry',
        null,
      );
    });

    it('cancelVendorOrder allows any store member via assertStoreAccess', async () => {
      await resolver.cancelVendorOrder('order-1', 'staff-1', 'store-1');

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('staff-1', 'store-1');
      expect(storesService.assertStoreOwner).not.toHaveBeenCalled();
      expect(orderFulfillmentService.cancelVendorOrder).toHaveBeenCalledWith(
        'staff-1',
        'store-1',
        'order-1',
      );
    });

    it('vendorOrders allows any store member via assertStoreAccess', async () => {
      ordersService.findByStore.mockResolvedValue([order]);

      await resolver.vendorOrders('store-1', 'staff-1');

      expect(storesService.assertStoreAccess).toHaveBeenCalledWith('staff-1', 'store-1');
      expect(ordersService.findByStore).toHaveBeenCalledWith('store-1');
    });
  });
});
