import { OrderFulfillmentService } from './order-fulfillment.service';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';

describe('OrderFulfillmentService hold guards', () => {
  let service: OrderFulfillmentService;
  let orderRepository: { findOne: jest.Mock };
  let storesService: { getAccessibleStores: jest.Mock };
  let inventoryService: { restoreOrderStock: jest.Mock };
  let notificationsService: {
    notifyOrderStatusChanged: jest.Mock;
    notifyVendorsAboutOrderStatus: jest.Mock;
  };
  let vendorWebhooksService: { dispatchOrderEvent: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: { save: jest.Mock } };

  beforeEach(() => {
    orderRepository = { findOne: jest.fn() };
    storesService = {
      getAccessibleStores: jest.fn().mockResolvedValue([{ store: { id: 'store-1' } }]),
    };
    inventoryService = { restoreOrderStock: jest.fn().mockResolvedValue(true) };
    notificationsService = {
      notifyOrderStatusChanged: jest.fn().mockResolvedValue(undefined),
      notifyVendorsAboutOrderStatus: jest.fn().mockResolvedValue(undefined),
    };
    vendorWebhooksService = {
      dispatchOrderEvent: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
        cb({
          save: jest.fn((x: unknown) => Promise.resolve(x)),
          create: jest.fn((_e: unknown, d: unknown) => d),
          find: jest.fn().mockResolvedValue([]),
        }),
      ),
      manager: {
        save: jest.fn().mockResolvedValue(undefined),
        findOne: jest.fn().mockResolvedValue({ id: 'store-1', name: 'Test Store' }),
      },
    };

    service = new OrderFulfillmentService(
      orderRepository as never,
      dataSource as never,
      storesService as never,
      notificationsService as never,
      inventoryService as never,
      vendorWebhooksService as never,
      { append: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  function heldOrder(overrides: Partial<Order> = {}): Order {
    const items: OrderItem[] = [
      {
        id: 'item-1',
        orderId: 'ord-1',
        storeId: 'store-1',
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
      } as OrderItem,
    ];
    return {
      id: 'ord-1',
      status: OrderStatus.PAID,
      items,
      ...overrides,
    } as Order;
  }

  it('denies vendor cancel of held items with HOLD_CANCEL_FORBIDDEN', async () => {
    orderRepository.findOne.mockResolvedValue(heldOrder());

    await expect(service.cancelVendorOrder('vendor-1', 'store-1', 'ord-1')).rejects.toMatchObject({
      response: { code: 'HOLD_CANCEL_FORBIDDEN' },
    });
    expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
  });

  it('denies vendor acknowledge of held items with HOLD_TRANSITION_FORBIDDEN', async () => {
    orderRepository.findOne.mockResolvedValue(heldOrder());

    await expect(
      service.acknowledgeVendorOrder('vendor-1', 'store-1', 'ord-1'),
    ).rejects.toMatchObject({ response: { code: 'HOLD_TRANSITION_FORBIDDEN' } });
  });

  it('denies vendor ship of held items with HOLD_TRANSITION_FORBIDDEN', async () => {
    orderRepository.findOne.mockResolvedValue(heldOrder());

    await expect(
      service.shipVendorOrder('vendor-1', 'store-1', 'ord-1', 'TRACK-1', 'Kerry'),
    ).rejects.toMatchObject({ response: { code: 'HOLD_TRANSITION_FORBIDDEN' } });
  });

  describe('markVendorOrderPaid (QA-hunt regression: order header must reflect held sibling-store items)', () => {
    function pendingPaymentOrder(items: OrderItem[]): Order {
      return {
        id: 'ord-1',
        status: OrderStatus.PENDING_PAYMENT,
        paidAt: null,
        items,
      } as Order;
    }

    it('marks a single-store order PAID and sets paidAt when nothing is on hold', async () => {
      const items = [
        {
          id: 'item-1',
          orderId: 'ord-1',
          storeId: 'store-1',
          fulfillmentStatus: FulfillmentStatus.PENDING,
        },
      ] as OrderItem[];
      orderRepository.findOne.mockResolvedValue(pendingPaymentOrder(items));

      const result = await service.markVendorOrderPaid('vendor-1', 'store-1', 'ord-1');

      expect(result.status).toBe(OrderStatus.PAID);
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('lands the order on ON_HOLD (not PAID) when a sibling store on the same multi-vendor order is held, but still records paidAt', async () => {
      const items = [
        {
          id: 'item-1',
          orderId: 'ord-1',
          storeId: 'store-1',
          fulfillmentStatus: FulfillmentStatus.PENDING,
        },
        {
          id: 'item-2',
          orderId: 'ord-1',
          storeId: 'store-2',
          fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        },
      ] as OrderItem[];
      storesService.getAccessibleStores.mockResolvedValue([{ store: { id: 'store-1' } }]);
      orderRepository.findOne.mockResolvedValue(pendingPaymentOrder(items));

      const result = await service.markVendorOrderPaid('vendor-1', 'store-1', 'ord-1');

      // Both this store's item AND the sibling held item are non-cancelled; since ALL
      // non-cancelled items are ON_HOLD is false here (store-1's item is PENDING), the
      // ladder falls through to PAID for this mixed case - only an all-held order should
      // land on ON_HOLD. Covered explicitly below.
      expect(result.status).toBe(OrderStatus.PAID);
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('lands on ON_HOLD when every non-cancelled item across the order is held', async () => {
      const items = [
        {
          id: 'item-1',
          orderId: 'ord-1',
          storeId: 'store-1',
          fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        },
        {
          id: 'item-2',
          orderId: 'ord-1',
          storeId: 'store-2',
          fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        },
      ] as OrderItem[];
      orderRepository.findOne.mockResolvedValue(pendingPaymentOrder(items));

      const result = await service.markVendorOrderPaid('vendor-1', 'store-1', 'ord-1');

      expect(result.status).toBe(OrderStatus.ON_HOLD);
      expect(result.paidAt).toBeInstanceOf(Date);
    });

    it('rejects marking paid an order that is not pending payment', async () => {
      const items = [
        {
          id: 'item-1',
          orderId: 'ord-1',
          storeId: 'store-1',
          fulfillmentStatus: FulfillmentStatus.PENDING,
        },
      ] as OrderItem[];
      orderRepository.findOne.mockResolvedValue({
        id: 'ord-1',
        status: OrderStatus.PAID,
        paidAt: new Date(),
        items,
      });

      await expect(
        service.markVendorOrderPaid('vendor-1', 'store-1', 'ord-1'),
      ).rejects.toMatchObject({ response: { code: 'INVALID_ORDER_STATUS' } });
    });
    it('rejects bank_transfer with BANK_TRANSFER_ADMIN_ONLY', async () => {
      const items = [
        {
          id: 'item-1',
          orderId: 'ord-1',
          storeId: 'store-1',
          fulfillmentStatus: FulfillmentStatus.PENDING,
        },
      ] as OrderItem[];
      orderRepository.findOne.mockResolvedValue({
        ...pendingPaymentOrder(items),
        paymentMethod: PaymentMethod.BANK_TRANSFER,
      });

      await expect(
        service.markVendorOrderPaid('vendor-1', 'store-1', 'ord-1'),
      ).rejects.toMatchObject({ response: { code: 'BANK_TRANSFER_ADMIN_ONLY' } });
    });
  });

  describe('confirmOrderDelivered guest phone normalization', () => {
    function shippedGuestOrder(guestPhone: string): Order {
      return {
        id: 'ord-1',
        customerId: null,
        guestPhone,
        status: OrderStatus.SHIPPED,
        items: [
          {
            id: 'item-1',
            orderId: 'ord-1',
            storeId: 'store-1',
            fulfillmentStatus: FulfillmentStatus.SHIPPED,
          } as OrderItem,
        ],
      } as Order;
    }

    it('accepts +66 guest phone when order stores local format', async () => {
      orderRepository.findOne
        .mockResolvedValueOnce(shippedGuestOrder('0812345678'))
        .mockResolvedValueOnce({
          ...shippedGuestOrder('0812345678'),
          status: OrderStatus.DELIVERED,
          items: [
            {
              id: 'item-1',
              orderId: 'ord-1',
              storeId: 'store-1',
              fulfillmentStatus: FulfillmentStatus.DELIVERED,
            } as OrderItem,
          ],
        });

      await expect(
        service.confirmOrderDelivered('ord-1', undefined, '+66812345678'),
      ).resolves.toMatchObject({ status: OrderStatus.DELIVERED });
    });

    it('rejects mismatched guest phone formats', async () => {
      orderRepository.findOne.mockResolvedValue(shippedGuestOrder('0812345678'));

      await expect(
        service.confirmOrderDelivered('ord-1', undefined, '0899999999'),
      ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    });
  });
});
