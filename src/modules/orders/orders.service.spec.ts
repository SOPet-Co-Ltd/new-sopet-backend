import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { CustomerOrderListFilter } from './order-list-filter.util';
import * as OrderMapper from './order.mapper';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let savedAddressRepository: { findOne: jest.Mock };
  let variantRepository: { findOne: jest.Mock };
  let shippingOptionRepository: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let notificationsService: {
    notifyOrderStatusChanged: jest.Mock;
    notifyVendorAboutNewOrder: jest.Mock;
    notifyVendorsAboutNewOrder: jest.Mock;
    notifyVendorsAboutOrderStatus: jest.Mock;
  };
  let promotionsService: { applyStackedPromotions: jest.Mock };
  let guestOrderLinkService: { mergeGuestOrders: jest.Mock };
  let inventoryService: { restoreOrderStock: jest.Mock };
  let mockManager: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
  };

  const variant = {
    id: 'var-1',
    productId: 'prod-1',
    stockQuantity: 10,
    options: { size: 'M' },
    product: { id: 'prod-1', storeId: 'store-1', name: 'Test Product' },
  };

  const shippingAddress = {
    recipientName: 'Somchai',
    recipientPhone: '+66812345678',
    addressLine1: '123 Sukhumvit',
    amphoe: 'Khlong Toei',
    province: 'Bangkok',
    postalCode: '10110',
  };

  beforeEach(() => {
    orderRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    savedAddressRepository = { findOne: jest.fn() };
    variantRepository = { findOne: jest.fn() };
    shippingOptionRepository = { findOne: jest.fn() };
    notificationsService = {
      notifyOrderStatusChanged: jest.fn(),
      notifyVendorAboutNewOrder: jest.fn().mockResolvedValue(undefined),
      notifyVendorsAboutNewOrder: jest.fn().mockResolvedValue(undefined),
      notifyVendorsAboutOrderStatus: jest.fn().mockResolvedValue(undefined),
    };
    promotionsService = { applyStackedPromotions: jest.fn() };
    guestOrderLinkService = { mergeGuestOrders: jest.fn() };
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };

    mockManager = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((entity: unknown, data?: unknown) => {
        const payload = data ?? entity;
        if (Array.isArray(payload)) return payload as unknown[];
        const record = payload as Record<string, unknown>;
        return { ...record, id: record.id ?? 'ord-1' };
      }),
      findOne: jest.fn().mockResolvedValue(variant),
      update: jest.fn(),
      increment: jest.fn(),
    };

    dataSource = {
      transaction: jest.fn((cb: (manager: typeof mockManager) => unknown) => cb(mockManager)),
    };

    service = new OrdersService(
      orderRepository as never,
      {} as never,
      savedAddressRepository as never,
      variantRepository as never,
      {} as never,
      shippingOptionRepository as never,
      dataSource as never,
      notificationsService as never,
      promotionsService as never,
      guestOrderLinkService as never,
      inventoryService as never,
      { removeItems: jest.fn() } as never,
      {} as never,
    );
  });

  it('requires guestPhone for guest checkout', async () => {
    await expect(
      service.create({
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        shippingAddress,
      }),
    ).rejects.toMatchObject({ response: { code: 'GUEST_PHONE_REQUIRED' } });
  });

  it('requires shipping address', async () => {
    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'SHIPPING_ADDRESS_REQUIRED' } });
  });

  it('requires amphoe in shipping address', async () => {
    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress: {
            ...shippingAddress,
            amphoe: '',
            city: '',
          },
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_SHIPPING_ADDRESS' } });
  });

  it('creates order on happy path', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    const savedOrder = {
      id: 'ord-1',
      orderNumber: 'ORD-TEST',
      status: OrderStatus.PENDING_PAYMENT,
      subtotal: 200,
      total: 200,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    };
    orderRepository.findOne.mockResolvedValue(savedOrder);

    const result = await service.create(
      {
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 2, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        guestName: 'Guest',
        shippingAddress,
      },
      undefined,
    );

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(mockManager.save).toHaveBeenCalled();
    expect(result.id).toBe('ord-1');
  });

  it('notifies vendor once per store when order has multiple items', async () => {
    const variantTwo = {
      ...variant,
      id: 'var-2',
      product: { id: 'prod-2', storeId: 'store-1', name: 'Second Product' },
    };
    variantRepository.findOne.mockResolvedValueOnce(variant).mockResolvedValueOnce(variantTwo);
    mockManager.findOne.mockResolvedValueOnce(variant).mockResolvedValueOnce(variantTwo);
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      orderNumber: 'ORD-TEST',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    await service.create(
      {
        items: [
          { productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 },
          { productId: 'p2', variantId: 'var-2', quantity: 1, price: 200 },
        ],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        shippingAddress,
      },
      undefined,
    );

    expect(notificationsService.notifyVendorsAboutNewOrder).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyVendorsAboutNewOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ord-1',
        // jest matchers are typed as any; safe in assertion context
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        items: expect.arrayContaining([
          expect.objectContaining({ storeId: 'store-1' }),
          expect.objectContaining({ storeId: 'store-1' }),
        ]),
      }),
    );
  });

  it('throws when order not found', async () => {
    orderRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects saved address for guest checkout', async () => {
    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          savedAddressId: 'addr-1',
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'SAVED_ADDRESS_REQUIRES_LOGIN' } });
  });

  it('rejects variant not found', async () => {
    variantRepository.findOne.mockResolvedValue(null);

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'missing', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'VARIANT_NOT_FOUND' } });
  });

  it('finds orders by customer', async () => {
    orderRepository.find.mockResolvedValue([{ id: 'ord-1' }]);

    const orders = await service.findByCustomer('cust-1');
    expect(orders).toHaveLength(1);
  });

  it('links guest orders to customer by phone', async () => {
    guestOrderLinkService.mergeGuestOrders.mockResolvedValue(2);

    const linked = await service.mergeGuestOrders('cust-1', '+66812345678');

    expect(linked).toBe(2);
    expect(guestOrderLinkService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '+66812345678');
  });

  it('updates order status and notifies', async () => {
    const order = {
      id: 'ord-1',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    };
    orderRepository.findOne.mockResolvedValue(order);

    const updated = await service.updateStatus('ord-1', OrderStatus.PAID, 'admin-1');

    expect(notificationsService.notifyOrderStatusChanged).toHaveBeenCalled();
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    expect(updated).toBeDefined();
  });

  it('restores stock when order is cancelled', async () => {
    const order = {
      id: 'ord-1',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    };
    orderRepository.findOne.mockResolvedValue(order);

    await service.updateStatus('ord-1', OrderStatus.CANCELLED, 'admin-1');

    expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
      'ord-1',
      mockManager,
      'Order status changed to cancelled',
    );
  });

  it('resolves saved address for logged-in customer', async () => {
    savedAddressRepository.findOne.mockResolvedValue({
      id: 'addr-1',
      customerId: 'cust-1',
      fullName: 'Customer',
      phone: '+66812345678',
      addressLine1: '1 Road',
      addressLine2: null,
      tumbon: 'Tumbon',
      amphoe: 'Amphoe',
      province: 'Bangkok',
      postalCode: '10110',
    });
    variantRepository.findOne.mockResolvedValue(variant);
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-2',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    const result = await service.create(
      {
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        savedAddressId: 'addr-1',
      },
      'cust-1',
    );

    expect(result.id).toBe('ord-2');
  });

  it('requires shipping option per store', async () => {
    variantRepository.findOne.mockResolvedValue(variant);

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
          storeShipping: [
            {
              storeId: 'other-store',
              shippingOptionId: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
            },
          ],
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'SHIPPING_OPTION_REQUIRED' } });
  });

  it('applies promotion codes on create', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    promotionsService.applyStackedPromotions.mockResolvedValue({
      discountAmount: 50,
      promotions: [{ id: 'promo-1', type: 'percentage', discountValue: 10 }],
      discountsByPromotionId: { 'promo-1': 50 },
      freeUnits: 0,
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-3',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    await service.create(
      {
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        shippingAddress,
        platformPromotionCode: 'SAVE10',
      },
      undefined,
    );

    expect(promotionsService.applyStackedPromotions).toHaveBeenCalledWith(
      100,
      expect.any(Map),
      'SAVE10',
      [],
      { guestPhone: '0812345678' },
      {
        mode: 'apply',
        lines: [
          {
            productId: 'prod-1',
            variantId: 'var-1',
            quantity: 1,
            unitPrice: 100,
            storeId: 'store-1',
          },
        ],
      },
    );
  });

  it('persists PromotionUsage discountAmount from discountsByPromotionId map', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    promotionsService.applyStackedPromotions.mockResolvedValue({
      discountAmount: 130,
      promotions: [
        { id: 'promo-platform', type: 'percentage', discountValue: 10 },
        { id: 'promo-bxgy', type: 'buy_x_get_y', discountValue: 0 },
      ],
      discountsByPromotionId: { 'promo-platform': 100, 'promo-bxgy': 30 },
      freeUnits: 1,
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-usage',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    await service.create(
      {
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 3, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        shippingAddress,
        platformPromotionCode: 'SAVE10',
        storePromotionCodes: ['BXGY'],
      },
      undefined,
    );

    const usagePayloads = mockManager.create.mock.calls
      .map((call: unknown[]) => call[1] as Record<string, unknown> | undefined)
      .filter((data) => data && 'promotionId' in data && 'discountAmount' in data);

    expect(usagePayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ promotionId: 'promo-platform', discountAmount: 100 }),
        expect.objectContaining({ promotionId: 'promo-bxgy', discountAmount: 30 }),
      ]),
    );
    expect(usagePayloads).toHaveLength(2);
  });

  it('create succeeds when stacking returns empty promotions (BxGy freeUnits=0 skip)', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    promotionsService.applyStackedPromotions.mockResolvedValue({
      discountAmount: 0,
      promotions: [],
      discountsByPromotionId: {},
      freeUnits: 0,
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-skip',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 2, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
          platformPromotionCode: 'BXGY21',
        },
        undefined,
      ),
    ).resolves.toBeDefined();

    const usagePayloads = mockManager.create.mock.calls
      .map((call: unknown[]) => call[1] as Record<string, unknown> | undefined)
      .filter((data) => data && 'promotionId' in data);
    expect(usagePayloads).toHaveLength(0);
  });

  describe('findByCustomerPaginated', () => {
    it('returns paginated orders with default page size', async () => {
      const queryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'ord-1' }], 25]),
      };
      orderRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.findByCustomerPaginated('cust-1');

      expect(orderRepository.createQueryBuilder).toHaveBeenCalledWith('order');
      expect(queryBuilder.where).toHaveBeenCalledWith('order.customerId = :customerId', {
        customerId: 'cust-1',
      });
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('applies status filter and caps limit at 50', async () => {
      const queryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      orderRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.findByCustomerPaginated('cust-1', {
        page: 2,
        limit: 100,
        filter: CustomerOrderListFilter.PENDING_PAYMENT,
      });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('order.status IN (:...statuses)', {
        statuses: ['pending_payment'],
      });
      expect(queryBuilder.skip).toHaveBeenCalledWith(50);
      expect(queryBuilder.take).toHaveBeenCalledWith(50);
    });
  });

  describe('findLatestPurchaseProductId', () => {
    it('returns product id from latest order item', async () => {
      const queryBuilder = {
        withDeleted: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ productId: 'prod-1' }),
      };
      orderRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const productId = await service.findLatestPurchaseProductId('cust-1');

      expect(productId).toBe('prod-1');
      expect(queryBuilder.withDeleted).toHaveBeenCalled();
    });
  });

  describe('findByOrderNumber', () => {
    const trackingRelations = [
      'items',
      'items.productVariant',
      'items.productVariant.product',
      'items.productVariant.product.images',
      'storeShippings',
    ];

    it('throws ORDER_NOT_FOUND when order does not exist', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.findByOrderNumber('ORD-MISSING')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_FOUND' },
      });
    });

    it('throws ORDER_NOT_FOUND for whitespace-only input', async () => {
      await expect(service.findByOrderNumber('   ')).rejects.toMatchObject({
        response: { code: 'ORDER_NOT_FOUND' },
      });
      expect(orderRepository.findOne).not.toHaveBeenCalled();
    });

    it('returns order when it exists', async () => {
      const order = { id: 'ord-1', orderNumber: 'ORD-TRACK-001', items: [], storeShippings: [] };
      orderRepository.findOne.mockResolvedValue(order);

      const result = await service.findByOrderNumber('ORD-TRACK-001');

      expect(result).toBe(order);
    });

    it('loads image-capable relations for tracking display', async () => {
      orderRepository.findOne.mockResolvedValue({ id: 'ord-1', orderNumber: 'ORD-TRACK-001' });

      await service.findByOrderNumber('  ORD-TRACK-001  ');

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { orderNumber: 'ORD-TRACK-001' },
        relations: trackingRelations,
        withDeleted: true,
      });
    });
  });

  describe('mapOrderTracking', () => {
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

    it('excludes PII fields when entity includes shippingAddress and guest fields', () => {
      const mapOrderTracking = (
        OrderMapper as unknown as { mapOrderTracking: (order: Order) => Record<string, unknown> }
      ).mapOrderTracking;

      expect(mapOrderTracking).toBeDefined();

      const createdAt = new Date('2024-06-15T10:30:00.000Z');
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-TRACK-001',
        customerId: 'cust-1',
        guestPhone: '0812345678',
        guestName: 'Guest User',
        guestEmail: 'guest@example.com',
        status: OrderStatus.PAID,
        subtotal: 500,
        discountAmount: 0,
        shippingFee: 80,
        total: 580,
        paymentMethod: PaymentMethod.PROMPTPAY,
        paymentReference: 'pay-ref-1',
        paidAt: createdAt,
        notes: 'Leave at door',
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
        ],
        shippingAddress: {
          id: 'addr-1',
          orderId: 'order-1',
          savedAddressId: null,
          fullName: 'Guest User',
          phone: '0812345678',
          addressLine1: '123 Main St',
          addressLine2: null,
          tumbon: null,
          amphoe: 'Bang Kapi',
          province: 'Bangkok',
          postalCode: '10240',
          createdAt,
        },
      } as Order;

      const result = mapOrderTracking(order);

      for (const key of PII_KEYS) {
        expect(result).not.toHaveProperty(key);
      }
    });
  });

  describe('findLatestPurchaseProductIds', () => {
    it('returns unique product ids in recent order order', async () => {
      const queryBuilder = {
        withDeleted: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([
            { productId: 'prod-1' },
            { productId: 'prod-1' },
            { productId: 'prod-2' },
            { productId: 'prod-3' },
          ]),
      };
      orderRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const productIds = await service.findLatestPurchaseProductIds('cust-1', 2);

      expect(productIds).toEqual(['prod-1', 'prod-2']);
      expect(queryBuilder.withDeleted).toHaveBeenCalled();
    });
  });
});
