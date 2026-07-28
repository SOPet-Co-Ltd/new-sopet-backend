import { OrderFulfillmentService } from './order-fulfillment.service';
import { Order, OrderStatus } from '../../database/entities/order.entity';
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
  let dataSource: { transaction: jest.Mock };

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
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
        cb({
          save: jest.fn((x: unknown) => Promise.resolve(x)),
          create: jest.fn((_e: unknown, d: unknown) => d),
          find: jest.fn().mockResolvedValue([]),
        }),
      ),
    };

    service = new OrderFulfillmentService(
      orderRepository as never,
      dataSource as never,
      storesService as never,
      notificationsService as never,
      inventoryService as never,
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
});
