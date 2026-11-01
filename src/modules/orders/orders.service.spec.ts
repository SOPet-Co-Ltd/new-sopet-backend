import { NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { CustomerOrderListFilter } from './order-list-filter.util';
import * as OrderMapper from './order.mapper';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
    query: jest.Mock;
  };
  let storeRepository: { find: jest.Mock };
  let savedAddressRepository: { findOne: jest.Mock };
  let variantRepository: { findOne: jest.Mock };
  let shippingOptionRepository: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock; getRepository: jest.Mock };
  let notificationsService: {
    notifyOrderStatusChanged: jest.Mock;
    notifyVendorAboutNewOrder: jest.Mock;
    notifyVendorsAboutNewOrder: jest.Mock;
    notifyVendorsAboutOrderStatus: jest.Mock;
  };
  let promotionsService: { applyStackedPromotions: jest.Mock };
  let guestOrderLinkService: { mergeGuestOrders: jest.Mock };
  let customerRepository: { findActiveByPhone: jest.Mock; setEmailIfMissing: jest.Mock };
  let inventoryService: { restoreOrderStock: jest.Mock };
  let cartService: { removeItems: jest.Mock; getCart: jest.Mock };
  let vendorWebhooksService: { dispatchOrderEvent: jest.Mock };
  let saleCampaignsService: { resolveEffectiveUnitPrices: jest.Mock };
  let orderAuditLogsService: {
    append: jest.Mock;
    resolveCustomerActorLabel: jest.Mock;
  };
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
    priceAdjustment: 0,
    options: { size: 'M' },
    product: { id: 'prod-1', storeId: 'store-1', name: 'Test Product', basePrice: 100 },
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
      query: jest.fn(),
    };
    storeRepository = { find: jest.fn().mockResolvedValue([]) };
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
    customerRepository = {
      findActiveByPhone: jest.fn().mockResolvedValue(null),
      setEmailIfMissing: jest.fn().mockResolvedValue(false),
    };
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };
    cartService = {
      removeItems: jest.fn(),
      getCart: jest.fn().mockResolvedValue({ items: [] }),
    };
    vendorWebhooksService = {
      dispatchOrderEvent: jest.fn().mockResolvedValue(undefined),
    };
    saleCampaignsService = {
      resolveEffectiveUnitPrices: jest.fn(
        async (lines: Array<{ variantId: string; catalogUnit: number }>) => {
          const map = new Map();
          for (const line of lines) {
            map.set(line.variantId, {
              catalogUnitPrice: line.catalogUnit,
              unitPrice: line.catalogUnit,
              saleCampaignId: null,
              saleDiscountPercent: null,
              compareAtPrice: null,
            });
          }
          return map;
        },
      ),
    };
    orderAuditLogsService = {
      append: jest.fn().mockResolvedValue(undefined),
      resolveCustomerActorLabel: jest.fn().mockResolvedValue('Guest'),
    };

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
      getRepository: jest.fn().mockReturnValue({
        save: jest.fn(async (entity: unknown) => entity),
      }),
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
      { publish: jest.fn().mockResolvedValue(undefined) } as never,
      promotionsService as never,
      guestOrderLinkService as never,
      customerRepository as never,
      inventoryService as never,
      cartService as never,
      storeRepository as never,
      vendorWebhooksService as never,
      saleCampaignsService as never,
      orderAuditLogsService as never,
    );
  });

  it('rejects create when cartItemIds are missing from cart (SF-CHK-112)', async () => {
    cartService.getCart.mockResolvedValue({
      items: [{ id: 'cart-other', variantId: 'var-1', quantity: 1 }],
    });

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
          cartItemIds: ['cart-removed'],
        },
        'cust-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_ITEMS_STALE' } });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects create when cart lines do not match order variants (SF-CHK-112)', async () => {
    cartService.getCart.mockResolvedValue({
      items: [{ id: 'cart-1', variantId: 'var-other', quantity: 1 }],
    });

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
          cartItemIds: ['cart-1'],
        },
        'cust-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_ITEMS_MISMATCH' } });
    expect(dataSource.transaction).not.toHaveBeenCalled();
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
    expect(mockManager.create).toHaveBeenCalledWith(
      Order,
      expect.objectContaining({
        guestPhone: '0812345678',
        guestPayTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        guestPayTokenExpiresAt: expect.any(Date),
      }),
    );
    expect(orderAuditLogsService.append).toHaveBeenCalledWith(
      mockManager,
      expect.objectContaining({
        eventType: 'ORDER_PLACED',
        actorType: 'customer',
        actorLabel: 'Guest',
      }),
    );
    expect(result.id).toBe('ord-1');
    expect(result.guestPayToken).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not issue guest pay token for authenticated createOrder', async () => {
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
      id: 'ord-auth',
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

    expect(mockManager.create).toHaveBeenCalledWith(
      Order,
      expect.objectContaining({
        customerId: 'cust-1',
        guestPayTokenHash: null,
        guestPayTokenExpiresAt: null,
      }),
    );
    expect(result.guestPayToken).toBeUndefined();
  });

  it('rejects create when locked catalog price changed mid-checkout (SF-CHK-114)', async () => {
    variantRepository.findOne.mockResolvedValue({
      ...variant,
      product: { ...variant.product, basePrice: 10 },
    });
    saleCampaignsService.resolveEffectiveUnitPrices
      .mockResolvedValueOnce(
        new Map([
          [
            'var-1',
            {
              catalogUnitPrice: 10,
              unitPrice: 10,
              saleCampaignId: null,
              saleDiscountPercent: null,
              compareAtPrice: null,
            },
          ],
        ]),
      )
      .mockResolvedValueOnce(
        new Map([
          [
            'var-1',
            {
              catalogUnitPrice: 12,
              unitPrice: 12,
              saleCampaignId: null,
              saleDiscountPercent: null,
              compareAtPrice: null,
            },
          ],
        ]),
      );
    mockManager.findOne.mockResolvedValue({
      ...variant,
      product: { ...variant.product, basePrice: 12 },
    });

    await expect(
      service.create(
        {
          items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 10 }],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          guestName: 'Guest',
          shippingAddress,
        },
        undefined,
      ),
    ).rejects.toMatchObject({ response: { code: 'PRICE_CHANGED' } });
  });

  it('overwrites client price with campaign sale unit and snapshots catalog (AC-004/013)', async () => {
    const saleVariant = {
      ...variant,
      priceAdjustment: 0,
      product: { ...variant.product, basePrice: 279 },
    };
    variantRepository.findOne.mockResolvedValue(saleVariant);
    mockManager.findOne.mockResolvedValue(saleVariant);
    const salePriceMap = new Map([
      [
        'var-1',
        {
          catalogUnitPrice: 279,
          unitPrice: 223.2,
          saleCampaignId: 'camp-1',
          saleDiscountPercent: 20,
          compareAtPrice: null,
        },
      ],
    ]);
    saleCampaignsService.resolveEffectiveUnitPrices.mockResolvedValue(salePriceMap);
    promotionsService.applyStackedPromotions.mockResolvedValue({
      discountAmount: 22.32,
      promotions: [{ id: 'promo-1', type: 'percentage', discountValue: 10 }],
      discountsByPromotionId: { 'promo-1': 22.32 },
      freeUnits: 0,
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-sale',
      orderNumber: 'ORD-SALE',
      status: OrderStatus.PENDING_PAYMENT,
      items: [],
      shippingAddress: {},
      storeShippings: [],
      statusHistory: [],
    });

    await service.create(
      {
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 279 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        guestName: 'Guest',
        shippingAddress,
        platformPromotionCode: 'SAVE10',
      },
      undefined,
    );

    expect(promotionsService.applyStackedPromotions).toHaveBeenCalledWith(
      223.2,
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
            unitPrice: 223.2,
            storeId: 'store-1',
          },
        ],
        shippingFee: 0,
        storeShippingFees: expect.any(Map),
      },
    );

    const orderItemCall = mockManager.create.mock.calls.find(([entity]) => entity === OrderItem);
    expect(orderItemCall?.[1]).toMatchObject({
      unitPrice: 223.2,
      catalogUnitPrice: 279,
      saleCampaignId: 'camp-1',
      saleDiscountPercent: 20,
      subtotal: 223.2,
    });
  });

  const orderCreatePayload = (): Record<string, unknown> => {
    const call = mockManager.create.mock.calls.find(([entity]) => entity === Order);
    if (!call) {
      throw new Error('Order entity was not created');
    }
    return call[1] as Record<string, unknown>;
  };

  it('links guest checkout to an existing member when the phone matches (AC guest-link)', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    customerRepository.findActiveByPhone.mockResolvedValue({ id: 'member-1' });
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        guestName: 'Guest',
        shippingAddress,
      },
      undefined,
    );

    expect(customerRepository.findActiveByPhone).toHaveBeenCalledWith('0812345678');
    const payload = orderCreatePayload();
    expect(payload.customerId).toBe('member-1');
    expect(payload.guestPhone).toBe('0812345678');
  });

  it('sets customer email from checkout when linked customer has none', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    customerRepository.findActiveByPhone.mockResolvedValue({ id: 'member-1', email: null });
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        guestName: 'Guest',
        guestEmail: '  new@example.com  ',
        shippingAddress,
      },
      undefined,
    );

    expect(customerRepository.setEmailIfMissing).toHaveBeenCalledWith(
      'member-1',
      'new@example.com',
    );
    const payload = orderCreatePayload();
    expect(payload.guestEmail).toBe('new@example.com');
  });

  it('sets customer email from checkout for authenticated create when present', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        guestEmail: 'auth@example.com',
        shippingAddress,
      },
      'cust-42',
    );

    expect(customerRepository.setEmailIfMissing).toHaveBeenCalledWith(
      'cust-42',
      'auth@example.com',
    );
    const payload = orderCreatePayload();
    expect(payload.guestEmail).toBe('auth@example.com');
  });

  it('does not call setEmailIfMissing when checkout email is empty', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        shippingAddress,
      },
      'cust-42',
    );

    expect(customerRepository.setEmailIfMissing).not.toHaveBeenCalled();
  });

  it('keeps guest order unlinked when no member matches the phone', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    customerRepository.findActiveByPhone.mockResolvedValue(null);
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        guestPhone: '+66812345678',
        shippingAddress,
      },
      undefined,
    );

    const payload = orderCreatePayload();
    expect(payload.customerId).toBeNull();
    expect(payload.guestPhone).toBe('0812345678');
  });

  it('does not look up a member when an authenticated customer places the order', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
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
        items: [{ productId: 'p1', variantId: 'var-1', quantity: 1, price: 100 }],
        paymentMethod: 'promptpay',
        shippingAddress,
      },
      'cust-42',
    );

    expect(customerRepository.findActiveByPhone).not.toHaveBeenCalled();
    const payload = orderCreatePayload();
    expect(payload.customerId).toBe('cust-42');
  });

  it('fails entire create when any variant belongs to suspended store (AC-006)', async () => {
    variantRepository.findOne
      .mockResolvedValueOnce({
        ...variant,
        id: 'var-ok',
        product: {
          id: 'prod-ok',
          storeId: 'store-ok',
          name: 'Ok Product',
          store: { status: 'approved' },
        },
      })
      .mockResolvedValueOnce({
        id: 'var-sus',
        productId: 'prod-sus',
        stockQuantity: 10,
        options: {},
        product: {
          id: 'prod-sus',
          storeId: 'store-sus',
          name: 'Suspended Product',
          store: { status: 'suspended' },
        },
      });

    await expect(
      service.create(
        {
          items: [
            { productId: 'prod-ok', variantId: 'var-ok', quantity: 1, price: 100 },
            { productId: 'prod-sus', variantId: 'var-sus', quantity: 1, price: 50 },
          ],
          paymentMethod: 'promptpay',
          guestPhone: '+66812345678',
          shippingAddress,
        },
        undefined,
      ),
    ).rejects.toMatchObject({
      response: { code: 'ORDER_CONTAINS_SUSPENDED_STORE' },
    });

    expect(dataSource.transaction).not.toHaveBeenCalled();
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
    expect(vendorWebhooksService.dispatchOrderEvent).toHaveBeenCalledWith('ord-1', 'order.create');
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

  it('updates shipping address as admin without clearing savedAddressId', async () => {
    const shipping = {
      id: 'addr-1',
      orderId: 'ord-1',
      savedAddressId: 'saved-1',
      fullName: 'Old Name',
      phone: '0811111111',
      addressLine1: 'Old Rd',
      addressLine2: null,
      tumbon: null,
      amphoe: 'Old Amphoe',
      province: 'Bangkok',
      postalCode: '10110',
    };
    const order = {
      id: 'ord-1',
      status: OrderStatus.PAID,
      items: [],
      shippingAddress: shipping,
      storeShippings: [],
      statusHistory: [],
    };
    orderRepository.findOne.mockResolvedValue(order);

    const updated = await service.updateShippingAddressAsAdmin('ord-1', {
      fullName: 'New Name',
      phone: '089-999-9999',
      addressLine1: '9/47',
      addressLine2: '',
      tumbon: 'บ้านใหม่',
      amphoe: 'ปากเกร็ด',
      province: 'นนทบุรี',
      postalCode: '11120',
    });

    expect(shipping.fullName).toBe('New Name');
    expect(shipping.phone).toBe('0899999999');
    expect(shipping.addressLine1).toBe('9/47');
    expect(shipping.addressLine2).toBeNull();
    expect(shipping.amphoe).toBe('ปากเกร็ด');
    expect(shipping.savedAddressId).toBe('saved-1');
    expect(dataSource.getRepository).toHaveBeenCalled();
    expect(updated).toBeDefined();
  });

  it('throws when order has no shipping address', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-1',
      shippingAddress: null,
    });

    await expect(
      service.updateShippingAddressAsAdmin('ord-1', {
        fullName: 'Name',
        phone: '0812345678',
        addressLine1: 'Line',
        amphoe: 'Amphoe',
        province: 'Bangkok',
        postalCode: '10110',
      }),
    ).rejects.toMatchObject({ response: { code: 'SHIPPING_ADDRESS_NOT_FOUND' } });
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

  describe('updateStatus hold hardening (AC-013–AC-015, AC-020)', () => {
    it('rejects setting status to on_hold with HOLD_TRANSITION_FORBIDDEN', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 'ord-1',
        status: OrderStatus.PAID,
        items: [],
        shippingAddress: {},
        storeShippings: [],
        statusHistory: [],
      });

      await expect(
        service.updateStatus('ord-1', OrderStatus.ON_HOLD, 'admin-1'),
      ).rejects.toMatchObject({ response: { code: 'HOLD_TRANSITION_FORBIDDEN' } });
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
    });

    it('rejects clearing on_hold to processing with HOLD_TRANSITION_FORBIDDEN', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 'ord-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [{ id: 'item-1', fulfillmentStatus: FulfillmentStatus.ON_HOLD }],
        shippingAddress: {},
        storeShippings: [],
        statusHistory: [],
      });

      await expect(
        service.updateStatus('ord-1', OrderStatus.PROCESSING, 'admin-1'),
      ).rejects.toMatchObject({ response: { code: 'HOLD_TRANSITION_FORBIDDEN' } });
    });

    it('allows admin cancel from on_hold and clears item snapshots', async () => {
      const heldItem = {
        id: 'item-1',
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date('2026-01-01'),
      };
      const order = {
        id: 'ord-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [heldItem],
        shippingAddress: {},
        storeShippings: [],
        statusHistory: [],
      };
      orderRepository.findOne.mockResolvedValue(order);

      await service.updateStatus('ord-1', OrderStatus.CANCELLED, 'admin-1');

      expect(heldItem.fulfillmentStatus).toBe(FulfillmentStatus.CANCELLED);
      expect(heldItem.previousFulfillmentStatus).toBeNull();
      expect(heldItem.holdStartedAt).toBeNull();
      expect(order.previousStatus).toBeNull();
      expect(inventoryService.restoreOrderStock).toHaveBeenCalled();
    });

    it('allows admin refund from on_hold', async () => {
      const order = {
        id: 'ord-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [
          {
            id: 'item-1',
            fulfillmentStatus: FulfillmentStatus.ON_HOLD,
            previousFulfillmentStatus: FulfillmentStatus.PROCESSING,
            holdStartedAt: new Date(),
          },
        ],
        shippingAddress: {},
        storeShippings: [],
        statusHistory: [],
      };
      orderRepository.findOne.mockResolvedValue(order);

      await service.updateStatus('ord-1', OrderStatus.REFUNDED, 'admin-1');

      expect(inventoryService.restoreOrderStock).toHaveBeenCalledWith(
        'ord-1',
        mockManager,
        'Order status changed to refunded',
      );
    });
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
        shippingFee: 0,
        storeShippingFees: expect.any(Map),
      },
    );
  });

  it('passes the resolved shipping fee to applyStackedPromotions (rows 24/25 regression)', async () => {
    variantRepository.findOne.mockResolvedValue(variant);
    shippingOptionRepository.findOne.mockResolvedValue({
      id: 'ship-opt-1',
      storeId: 'store-1',
      name: 'Standard',
      price: 45,
      isActive: true,
    });
    promotionsService.applyStackedPromotions.mockResolvedValue({
      discountAmount: 45,
      promotions: [{ id: 'promo-freeship', type: 'free_shipping', discountValue: 0 }],
      discountsByPromotionId: { 'promo-freeship': 45 },
      freeUnits: 0,
    });
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-4',
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
        platformPromotionCode: 'FREESHIP',
        storeShipping: [{ storeId: 'store-1', shippingOptionId: 'ship-opt-1' }],
      },
      undefined,
    );

    expect(promotionsService.applyStackedPromotions).toHaveBeenCalledWith(
      100,
      expect.any(Map),
      'FREESHIP',
      [],
      { guestPhone: '0812345678' },
      expect.objectContaining({
        shippingFee: 45,
        storeShippingFees: expect.any(Map),
      }),
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
    function createCustomerListQb(overrides: Record<string, jest.Mock> = {}) {
      return {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    it('returns paginated orders with default page size', async () => {
      const countQb = createCustomerListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '25' }),
      });
      const idQb = createCustomerListQb({
        getRawMany: jest.fn().mockResolvedValue([{ id: 'ord-1' }]),
      });
      const hydrateQb = createCustomerListQb({
        getMany: jest.fn().mockResolvedValue([{ id: 'ord-1' }]),
      });
      orderRepository.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(idQb)
        .mockReturnValueOnce(hydrateQb);

      const result = await service.findByCustomerPaginated('cust-1');

      expect(orderRepository.createQueryBuilder).toHaveBeenCalledWith('order');
      expect(countQb.where).toHaveBeenCalledWith('order.customerId = :customerId', {
        customerId: 'cust-1',
      });
      expect(idQb.offset).toHaveBeenCalledWith(0);
      expect(idQb.limit).toHaveBeenCalledWith(10);
      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('applies status filter and caps limit at 50', async () => {
      const countQb = createCustomerListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '100' }),
      });
      const idQb = createCustomerListQb({
        getRawMany: jest.fn().mockResolvedValue([]),
      });
      orderRepository.createQueryBuilder.mockReturnValueOnce(countQb).mockReturnValueOnce(idQb);

      await service.findByCustomerPaginated('cust-1', {
        page: 2,
        limit: 100,
        filter: CustomerOrderListFilter.PENDING_PAYMENT,
      });

      expect(countQb.andWhere).toHaveBeenCalledWith('order.status IN (:...statuses)', {
        statuses: ['pending_payment'],
      });
      expect(idQb.offset).toHaveBeenCalledWith(50);
      expect(idQb.limit).toHaveBeenCalledWith(50);
    });
  });

  describe('findForAdmin', () => {
    function createAdminListQb(overrides: Record<string, jest.Mock> = {}) {
      return {
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    it('returns empty page when no orders match', async () => {
      const qb = createAdminListQb();
      orderRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findForAdmin({ page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    });

    it('pages newest-first, applies search/status, and resolves multi-store names plus customer', async () => {
      const countQb = createAdminListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '2' }),
      });
      const idQb = createAdminListQb({
        getRawMany: jest.fn().mockResolvedValue([{ id: 'ord-2' }, { id: 'ord-1' }]),
      });
      const loadQb = createAdminListQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'ord-1',
            orderNumber: 'ORD-1',
            customerId: 'cust-1',
            customer: {
              id: 'cust-1',
              fullName: 'Somchai',
              phone: '0811111111',
              email: 'a@example.com',
            },
            items: [
              { storeId: 'store-1', productName: 'A' },
              { storeId: 'store-2', productName: 'B' },
            ],
          },
          {
            id: 'ord-2',
            orderNumber: 'ORD-2',
            customerId: null,
            customer: null,
            guestName: 'Guest',
            guestPhone: '0822222222',
            items: [{ storeId: 'store-1', productName: 'C' }],
          },
        ]),
      });

      orderRepository.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(idQb)
        .mockReturnValueOnce(loadQb);

      storeRepository.find.mockResolvedValue([
        { id: 'store-1', name: 'Pet Shop A' },
        { id: 'store-2', name: 'Pet Shop B' },
      ]);

      const result = await service.findForAdmin({
        page: 1,
        limit: 20,
        search: 'ORD',
        status: OrderStatus.PAID,
      });

      expect(countQb.andWhere).toHaveBeenCalledWith('order.orderNumber ILIKE :search', {
        search: '%ORD%',
      });
      expect(countQb.andWhere).toHaveBeenCalledWith('order.status = :status', {
        status: OrderStatus.PAID,
      });
      expect(idQb.orderBy).toHaveBeenCalledWith('order.createdAt', 'DESC');
      expect(idQb.offset).toHaveBeenCalledWith(0);
      expect(idQb.limit).toHaveBeenCalledWith(20);
      expect(result.items.map((row) => row.order.id)).toEqual(['ord-2', 'ord-1']);
      expect(result.items[1].stores).toEqual([
        { id: 'store-1', name: 'Pet Shop A' },
        { id: 'store-2', name: 'Pet Shop B' },
      ]);
      expect(result.items[1].customer).toEqual({
        id: 'cust-1',
        fullName: 'Somchai',
        phone: '0811111111',
        email: 'a@example.com',
      });
      expect(result.items[0].customer).toBeNull();
      expect(result.pagination.total).toBe(2);
    });

    it('uses empty store name when store row is missing', async () => {
      const countQb = createAdminListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '1' }),
      });
      const idQb = createAdminListQb({
        getRawMany: jest.fn().mockResolvedValue([{ id: 'ord-1' }]),
      });
      const loadQb = createAdminListQb({
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'ord-1',
            customerId: null,
            customer: null,
            items: [{ storeId: 'missing-store' }],
          },
        ]),
      });

      orderRepository.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(idQb)
        .mockReturnValueOnce(loadQb);
      storeRepository.find.mockResolvedValue([]);

      const result = await service.findForAdmin();

      expect(result.items[0].stores).toEqual([{ id: 'missing-store', name: '' }]);
    });
  });

  describe('findByStorePage', () => {
    function createVendorListQb(overrides: Record<string, jest.Mock> = {}) {
      return {
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    it('returns empty page with actionableCount when no orders match', async () => {
      const listCountQb = createVendorListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
      });
      const actionableQb = createVendorListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '3' }),
      });
      orderRepository.createQueryBuilder
        .mockReturnValueOnce(listCountQb)
        .mockReturnValueOnce(actionableQb);

      const result = await service.findByStorePage('store-1', { page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
      expect(result.actionableCount).toBe(3);
    });

    it('pages newest-first and hydrates only the requested ids', async () => {
      const listCountQb = createVendorListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '2' }),
      });
      const actionableQb = createVendorListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '1' }),
      });
      const idQb = createVendorListQb({
        getRawMany: jest.fn().mockResolvedValue([{ id: 'ord-2' }, { id: 'ord-1' }]),
      });
      const loadQb = createVendorListQb({
        getMany: jest.fn().mockResolvedValue([
          { id: 'ord-1', orderNumber: 'ORD-1', items: [] },
          { id: 'ord-2', orderNumber: 'ORD-2', items: [] },
        ]),
      });

      orderRepository.createQueryBuilder
        .mockReturnValueOnce(listCountQb)
        .mockReturnValueOnce(actionableQb)
        .mockReturnValueOnce(idQb)
        .mockReturnValueOnce(loadQb);

      const result = await service.findByStorePage('store-1', {
        page: 1,
        limit: 20,
        search: 'ORD',
        status: OrderStatus.PAID,
      });

      expect(listCountQb.andWhere).toHaveBeenCalledWith('order.order_number ILIKE :search', {
        search: '%ORD%',
      });
      expect(listCountQb.andWhere).toHaveBeenCalledWith('order.status = :status', {
        status: OrderStatus.PAID,
      });
      expect(idQb.orderBy).toHaveBeenCalledWith('order.createdAt', 'DESC');
      expect(idQb.offset).toHaveBeenCalledWith(0);
      expect(idQb.limit).toHaveBeenCalledWith(20);
      expect(loadQb.leftJoinAndSelect).toHaveBeenCalledWith(
        'order.items',
        'items',
        'items.storeId = :storeId',
        { storeId: 'store-1' },
      );
      expect(result.items.map((order) => order.id)).toEqual(['ord-2', 'ord-1']);
      expect(result.pagination.total).toBe(2);
      expect(result.actionableCount).toBe(1);
    });
  });

  describe('findOneForAdmin', () => {
    it('returns stores and registered customer for one order', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 'ord-1',
        customerId: 'cust-1',
        customer: {
          id: 'cust-1',
          fullName: 'Somchai',
          phone: '0811111111',
          email: null,
        },
        items: [{ storeId: 'store-1' }, { storeId: 'store-1' }, { storeId: 'store-2' }],
      });
      storeRepository.find.mockResolvedValue([
        { id: 'store-1', name: 'Alpha' },
        { id: 'store-2', name: 'Beta' },
      ]);

      const result = await service.findOneForAdmin('ord-1');

      expect(result.stores).toEqual([
        { id: 'store-1', name: 'Alpha' },
        { id: 'store-2', name: 'Beta' },
      ]);
      expect(result.customer?.id).toBe('cust-1');
    });

    it('throws ORDER_NOT_FOUND when missing', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.findOneForAdmin('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAllForPublicApi', () => {
    function createPublicApiListQb(overrides: Record<string, jest.Mock> = {}) {
      return {
        innerJoin: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
        getRawMany: jest.fn().mockResolvedValue([]),
        getMany: jest.fn().mockResolvedValue([]),
        ...overrides,
      };
    }

    it('returns empty page when store has no matching orders', async () => {
      const qb = createPublicApiListQb();
      orderRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAllForPublicApi('store-1', { page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    });

    it('loads orders by id after distinct pagination and applies filters', async () => {
      const countQb = createPublicApiListQb({
        getRawOne: jest.fn().mockResolvedValue({ cnt: '2' }),
      });
      const idQb = createPublicApiListQb({
        getRawMany: jest.fn().mockResolvedValue([{ id: 'ord-2' }, { id: 'ord-1' }]),
      });
      const loadQb = createPublicApiListQb({
        getMany: jest.fn().mockResolvedValue([
          { id: 'ord-1', orderNumber: 'A' },
          { id: 'ord-2', orderNumber: 'B' },
        ]),
      });

      orderRepository.createQueryBuilder
        .mockReturnValueOnce(countQb)
        .mockReturnValueOnce(idQb)
        .mockReturnValueOnce(loadQb);

      const result = await service.findAllForPublicApi('store-1', {
        page: 1,
        limit: 20,
        status: OrderStatus.PAID,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        updatedSince: '2026-08-01T00:00:00.000Z',
      });

      expect(countQb.andWhere).toHaveBeenCalledWith('order.status = :status', {
        status: OrderStatus.PAID,
      });
      expect(countQb.andWhere).toHaveBeenCalledWith(
        'filterItem.fulfillmentStatus = :fulfillmentStatus',
        { fulfillmentStatus: FulfillmentStatus.PENDING },
      );
      expect(idQb.offset).toHaveBeenCalledWith(0);
      expect(idQb.limit).toHaveBeenCalledWith(20);
      expect(loadQb.where).toHaveBeenCalledWith('order.id IN (:...ids)', {
        ids: ['ord-2', 'ord-1'],
      });
      expect(result.items.map((o) => o.id)).toEqual(['ord-2', 'ord-1']);
      expect(result.pagination.total).toBe(2);
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
    it('asks SQL for distinct recent product ids with a limit', async () => {
      orderRepository.query.mockResolvedValue([{ productId: 'prod-1' }, { productId: 'prod-2' }]);

      const productIds = await service.findLatestPurchaseProductIds('cust-1', 2);

      expect(productIds).toEqual(['prod-1', 'prod-2']);
      const [sql, params] = orderRepository.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('DISTINCT ON');
      expect(sql).toContain('LIMIT');
      expect(params).toEqual(['cust-1', 2]);
      expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
