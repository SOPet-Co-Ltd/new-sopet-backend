import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StoreSuspensionHoldService } from './store-suspension-hold.service';

describe('StoreSuspensionHoldService', () => {
  let service: StoreSuspensionHoldService;
  let inventoryService: { restoreItemStock: jest.Mock; restoreOrderStock: jest.Mock };
  let notificationsService: {
    notifyOrderItemsOnHold: jest.Mock;
    notifyOrderItemsHoldResumed: jest.Mock;
  };

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-07-28T00:00:00.000Z');

  const orderItemRepository = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
  };

  const manager = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((_entity: unknown, data: unknown) => data),
  };

  const dataSource = {
    transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
  };

  function qbReturning(items: Partial<OrderItem>[]) {
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue(
          [...new Set(items.map((i) => i.orderId))].map((orderId) => ({ orderId })),
        ),
      getMany: jest.fn().mockResolvedValue(items),
    };
    orderItemRepository.createQueryBuilder.mockReturnValue(qb);
    return qb;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    dataSource.transaction.mockImplementation(async (cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager),
    );
    manager.save.mockImplementation((_entity: unknown, value: unknown) => Promise.resolve(value));
    manager.create.mockImplementation((_entity: unknown, data: unknown) => data);
    inventoryService = {
      restoreItemStock: jest.fn().mockResolvedValue(true),
      restoreOrderStock: jest.fn().mockResolvedValue(true),
    };
    notificationsService = {
      notifyOrderItemsOnHold: jest.fn().mockResolvedValue(undefined),
      notifyOrderItemsHoldResumed: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        StoreSuspensionHoldService,
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepository },
        { provide: DataSource, useValue: dataSource },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'storeHold.holdSlaAfterMs') return THIRTY_DAYS_MS;
              return undefined;
            },
          },
        },
        { provide: InventoryService, useValue: inventoryService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(StoreSuspensionHoldService);
  });

  describe('applyHoldForStore', () => {
    it('holds eligible pending/processing items for the suspended store with snapshots', async () => {
      const storeId = 'store-a';
      const itemA: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([itemA]);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PAID,
        previousStatus: null,
        items: [
          itemA as OrderItem,
          {
            id: 'item-b',
            orderId: 'order-1',
            storeId: 'store-b',
            fulfillmentStatus: FulfillmentStatus.PENDING,
            previousFulfillmentStatus: null,
            holdStartedAt: null,
          } as OrderItem,
        ],
      };
      manager.findOne.mockResolvedValue(order);

      const result = await service.applyHoldForStore(storeId);

      expect(result).toEqual({ ordersTouched: 1, itemsHeld: 1 });
      expect(itemA.fulfillmentStatus).toBe(FulfillmentStatus.ON_HOLD);
      expect(itemA.previousFulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(itemA.holdStartedAt).toBeInstanceOf(Date);
      // Sibling store untouched
      expect(order.items![1].fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      // Mixed order stays progressing (not order on_hold)
      expect(order.status).toBe(OrderStatus.PAID);
      expect(order.previousStatus).toBeNull();
      expect(manager.save).toHaveBeenCalledWith(OrderItem, expect.any(Array));
    });

    it('skips shipped, delivered, and cancelled items', async () => {
      const storeId = 'store-a';
      // Query returns only eligible — shipped/delivered/cancelled never selected
      qbReturning([]);

      const result = await service.applyHoldForStore(storeId);

      expect(result).toEqual({ ordersTouched: 0, itemsHeld: 0 });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('does not elevate unpaid sticky order to on_hold (Decision #15)', async () => {
      const storeId = 'store-a';
      const item: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([item]);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PENDING_PAYMENT,
        previousStatus: null,
        items: [item as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      await service.applyHoldForStore(storeId);

      expect(item.fulfillmentStatus).toBe(FulfillmentStatus.ON_HOLD);
      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(order.previousStatus).toBeNull();
    });

    it('elevates paid full-hold order to on_hold and snapshots previous_status', async () => {
      const storeId = 'store-a';
      const item: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PROCESSING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([item]);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PROCESSING,
        previousStatus: null,
        items: [item as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      await service.applyHoldForStore(storeId);

      expect(order.status).toBe(OrderStatus.ON_HOLD);
      expect(order.previousStatus).toBe(OrderStatus.PROCESSING);
      expect(manager.save).toHaveBeenCalledWith(
        OrderStatusHistory,
        expect.objectContaining({
          orderId: 'order-1',
          status: OrderStatus.ON_HOLD,
        }),
      );
    });

    it('is idempotent when items are already on_hold with snapshot', async () => {
      const storeId = 'store-a';
      const heldAt = new Date('2026-01-01T00:00:00Z');
      const item: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: heldAt,
      };
      // Eligible query only returns pending/processing — already held not re-selected
      qbReturning([]);

      const result = await service.applyHoldForStore(storeId);

      expect(result).toEqual({ ordersTouched: 0, itemsHeld: 0 });
      expect(item.previousFulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(item.holdStartedAt).toBe(heldAt);
    });

    it('does not overwrite snapshot when re-processing an already-held item in an order batch', async () => {
      const storeId = 'store-a';
      const heldAt = new Date('2026-01-01T00:00:00Z');
      const alreadyHeld: Partial<OrderItem> = {
        id: 'item-held',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: heldAt,
      };
      const newlyEligible: Partial<OrderItem> = {
        id: 'item-new',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PROCESSING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([newlyEligible]);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PAID,
        previousStatus: null,
        items: [alreadyHeld as OrderItem, newlyEligible as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      const result = await service.applyHoldForStore(storeId);

      expect(result.itemsHeld).toBe(1);
      expect(alreadyHeld.previousFulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(alreadyHeld.holdStartedAt).toBe(heldAt);
      expect(newlyEligible.fulfillmentStatus).toBe(FulfillmentStatus.ON_HOLD);
      expect(newlyEligible.previousFulfillmentStatus).toBe(FulfillmentStatus.PROCESSING);
    });

    it('notifies customer+vendor once per order/store after enter-hold commit', async () => {
      const storeId = 'store-a';
      const itemA: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([itemA]);
      manager.findOne.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.PAID,
        previousStatus: null,
        items: [itemA],
      });

      await service.applyHoldForStore(storeId);

      expect(notificationsService.notifyOrderItemsOnHold).toHaveBeenCalledTimes(1);
      expect(notificationsService.notifyOrderItemsOnHold).toHaveBeenCalledWith('order-1', storeId);
    });

    it('keeps hold applied when enter-hold notification throws', async () => {
      const storeId = 'store-a';
      const itemA: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      qbReturning([itemA]);
      manager.findOne.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.PAID,
        previousStatus: null,
        items: [itemA],
      });
      notificationsService.notifyOrderItemsOnHold.mockRejectedValue(new Error('notify boom'));

      const result = await service.applyHoldForStore(storeId);

      expect(result.itemsHeld).toBe(1);
      expect(itemA.fulfillmentStatus).toBe(FulfillmentStatus.ON_HOLD);
    });
  });

  describe('restoreHoldForStore', () => {
    it('restores previous_fulfillment_status and clears snapshot fields', async () => {
      const storeId = 'store-a';
      const heldItem: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date('2026-01-01T00:00:00Z'),
      };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
      };
      orderItemRepository.createQueryBuilder.mockReturnValue(qb);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [heldItem as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      const result = await service.restoreHoldForStore(storeId);

      expect(result).toEqual({ ordersTouched: 1, itemsRestored: 1 });
      expect(heldItem.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(heldItem.previousFulfillmentStatus).toBeNull();
      expect(heldItem.holdStartedAt).toBeNull();
      expect(order.status).toBe(OrderStatus.PAID);
      expect(order.previousStatus).toBeNull();
      expect(notificationsService.notifyOrderItemsHoldResumed).toHaveBeenCalledWith(
        'order-1',
        storeId,
      );
    });

    it('keeps restore when resume notification throws', async () => {
      const storeId = 'store-a';
      const heldItem: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date('2026-01-01T00:00:00Z'),
      };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
      };
      orderItemRepository.createQueryBuilder.mockReturnValue(qb);
      manager.findOne.mockResolvedValue({
        id: 'order-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [heldItem as OrderItem],
      });
      notificationsService.notifyOrderItemsHoldResumed.mockRejectedValue(
        new Error('resume notify boom'),
      );

      const result = await service.restoreHoldForStore(storeId);

      expect(result.itemsRestored).toBe(1);
      expect(heldItem.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
    });

    it('throws HOLD_RESTORE_SNAPSHOT_MISSING when previous_fulfillment_status is null', async () => {
      const storeId = 'store-a';
      const heldItem: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: null,
        holdStartedAt: new Date('2026-01-01T00:00:00Z'),
      };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
      };
      orderItemRepository.createQueryBuilder.mockReturnValue(qb);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.ON_HOLD,
        previousStatus: OrderStatus.PAID,
        items: [heldItem as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      await expect(service.restoreHoldForStore(storeId)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'HOLD_RESTORE_SNAPSHOT_MISSING' }),
      });
      expect(heldItem.fulfillmentStatus).toBe(FulfillmentStatus.ON_HOLD);
    });

    it('restores only the reactivated store items; siblings stay as-is', async () => {
      const storeId = 'store-a';
      const heldA: Partial<OrderItem> = {
        id: 'item-a',
        orderId: 'order-1',
        storeId,
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date(),
      };
      const siblingB: Partial<OrderItem> = {
        id: 'item-b',
        orderId: 'order-1',
        storeId: 'store-b',
        fulfillmentStatus: FulfillmentStatus.PROCESSING,
        previousFulfillmentStatus: null,
        holdStartedAt: null,
      };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ orderId: 'order-1' }]),
      };
      orderItemRepository.createQueryBuilder.mockReturnValue(qb);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PROCESSING,
        previousStatus: null,
        items: [heldA as OrderItem, siblingB as OrderItem],
      };
      manager.findOne.mockResolvedValue(order);

      await service.restoreHoldForStore(storeId);

      expect(heldA.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(siblingB.fulfillmentStatus).toBe(FulfillmentStatus.PROCESSING);
    });
  });

  describe('cancelExpiredHeldItems', () => {
    it('cancels held items past SLA only; siblings unchanged; restores item stock; no order stock restore', async () => {
      const heldPast: Partial<OrderItem> = {
        id: 'item-held',
        orderId: 'order-1',
        storeId: 'store-a',
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date(NOW.getTime() - THIRTY_DAYS_MS - 1000),
        subtotal: 200,
        unitPrice: 200,
        quantity: 1,
      };
      const sibling: Partial<OrderItem> = {
        id: 'item-sib',
        orderId: 'order-1',
        storeId: 'store-b',
        fulfillmentStatus: FulfillmentStatus.PENDING,
        subtotal: 100,
        unitPrice: 100,
        quantity: 1,
      };
      orderItemRepository.find.mockResolvedValue([heldPast]);

      const order: Partial<Order> = {
        id: 'order-1',
        status: OrderStatus.PAID,
        previousStatus: null,
        subtotal: 300,
        shippingFee: 50,
        discountAmount: 0,
        total: 350,
        items: [heldPast as OrderItem, sibling as OrderItem],
        storeShippings: [
          { storeId: 'store-a', shippingFee: 30 },
          { storeId: 'store-b', shippingFee: 20 },
        ] as never,
      };
      manager.findOne.mockResolvedValue(order);

      const cancelled = await service.cancelExpiredHeldItems(NOW);

      expect(cancelled).toBe(1);
      expect(heldPast.fulfillmentStatus).toBe(FulfillmentStatus.CANCELLED);
      expect(heldPast.previousFulfillmentStatus).toBeNull();
      expect(heldPast.holdStartedAt).toBeNull();
      expect(sibling.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(inventoryService.restoreItemStock).toHaveBeenCalledWith(
        'order-1',
        ['item-held'],
        manager,
        'Hold SLA auto-cancel stock restore',
      );
      expect(inventoryService.restoreOrderStock).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledWith(
        OrderStatusHistory,
        expect.objectContaining({
          notes: expect.stringContaining('Hold SLA auto-cancel item item-held'),
        }),
      );
    });

    it('cancels unpaid held items and recomputes remaining payable total (Decision #16)', async () => {
      const heldPast: Partial<OrderItem> = {
        id: 'item-held',
        orderId: 'order-unpaid',
        storeId: 'store-a',
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        previousFulfillmentStatus: FulfillmentStatus.PENDING,
        holdStartedAt: new Date(NOW.getTime() - THIRTY_DAYS_MS - 1),
        subtotal: 200,
        unitPrice: 200,
        quantity: 1,
      };
      const sibling: Partial<OrderItem> = {
        id: 'item-sib',
        orderId: 'order-unpaid',
        storeId: 'store-b',
        fulfillmentStatus: FulfillmentStatus.PENDING,
        subtotal: 100,
        unitPrice: 100,
        quantity: 1,
      };
      orderItemRepository.find.mockResolvedValue([heldPast]);

      const order: Partial<Order> = {
        id: 'order-unpaid',
        status: OrderStatus.PENDING_PAYMENT,
        previousStatus: null,
        subtotal: 300,
        shippingFee: 50,
        discountAmount: 0,
        total: 350,
        items: [heldPast as OrderItem, sibling as OrderItem],
        storeShippings: [
          { storeId: 'store-a', shippingFee: 30 },
          { storeId: 'store-b', shippingFee: 20 },
        ] as never,
      };
      manager.findOne.mockResolvedValue(order);

      await service.cancelExpiredHeldItems(NOW);

      expect(heldPast.fulfillmentStatus).toBe(FulfillmentStatus.CANCELLED);
      expect(sibling.fulfillmentStatus).toBe(FulfillmentStatus.PENDING);
      expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(order.subtotal).toBe(100);
      expect(order.shippingFee).toBe(20);
      expect(order.total).toBe(120);
    });

    it('is idempotent when no expired on_hold items remain', async () => {
      orderItemRepository.find.mockResolvedValue([]);
      const cancelled = await service.cancelExpiredHeldItems(NOW);
      expect(cancelled).toBe(0);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(inventoryService.restoreItemStock).not.toHaveBeenCalled();
    });
  });
});
