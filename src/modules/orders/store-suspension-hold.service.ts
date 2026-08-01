import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { InventoryService } from '../inventory/inventory.service';
import { NotificationsService } from '../notifications/notifications.service';
import { deriveOrderStatusFromFulfillment } from './order-fulfillment.util';
import { recomputeOrderPayableTotals } from './order-totals.util';

export type HoldApplyResult = {
  ordersTouched: number;
  itemsHeld: number;
};

export type HoldRestoreResult = {
  ordersTouched: number;
  itemsRestored: number;
};

const ADMIN_HOLD_EXIT_STATUSES = new Set<OrderStatus>([
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
]);

/**
 * System-only hold transitions: reject free-form set/clear of on_hold.
 * Admin cancel/refund from on_hold is allowed (AC-020).
 */
export function assertNotManualHoldTransition(from: OrderStatus, to: OrderStatus): void {
  if (to === OrderStatus.ON_HOLD) {
    throw new BadRequestException({
      code: 'HOLD_TRANSITION_FORBIDDEN',
      message: 'Setting on_hold via updateOrderStatus is not allowed',
    });
  }
  if (from === OrderStatus.ON_HOLD && !ADMIN_HOLD_EXIT_STATUSES.has(to)) {
    throw new BadRequestException({
      code: 'HOLD_TRANSITION_FORBIDDEN',
      message: 'Clearing on_hold via updateOrderStatus is not allowed',
    });
  }
}

const HOLD_ELIGIBLE_FULFILLMENT = new Set<FulfillmentStatus>([
  FulfillmentStatus.PENDING,
  FulfillmentStatus.PROCESSING,
]);

const HOLD_ELIGIBLE_ORDER_STATUSES = new Set<OrderStatus>([
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
]);

@Injectable()
export class StoreSuspensionHoldService {
  private readonly logger = new Logger(StoreSuspensionHoldService.name);

  constructor(
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly inventoryService: InventoryService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private getHoldSlaAfterMs(): number {
    const configured = this.configService.get<number>('storeHold.holdSlaAfterMs');
    return configured && configured > 0 ? configured : 30 * 24 * 60 * 60 * 1000;
  }

  /**
   * System-only: place hold-eligible items for a suspended store into on_hold.
   * Per-order transactions; sibling stores and shipped/delivered/cancelled skipped.
   */
  async applyHoldForStore(storeId: string): Promise<HoldApplyResult> {
    const orderIds = await this.findOrderIdsWithEligibleItems(storeId);
    let ordersTouched = 0;
    let itemsHeld = 0;

    for (const orderId of orderIds) {
      try {
        const held = await this.dataSource.transaction((manager) =>
          this.applyHoldForOrder(manager, storeId, orderId),
        );
        if (held > 0) {
          ordersTouched += 1;
          itemsHeld += held;
          // After commit: best-effort notify (ADR-0010 — failure must not roll back hold).
          try {
            await this.notificationsService.notifyOrderItemsOnHold(orderId, storeId);
          } catch (error) {
            this.logger.warn(
              `Hold enter notification failed for store=${storeId} order=${orderId}`,
              error instanceof Error ? error.message : undefined,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          `applyHoldForStore failed for store=${storeId} order=${orderId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return { ordersTouched, itemsHeld };
  }

  /**
   * System-only: restore held items for a reactivated store to previous_fulfillment_status.
   */
  async restoreHoldForStore(storeId: string): Promise<HoldRestoreResult> {
    const orderIds = await this.findOrderIdsWithHeldItems(storeId);
    let ordersTouched = 0;
    let itemsRestored = 0;

    for (const orderId of orderIds) {
      const restored = await this.dataSource.transaction((manager) =>
        this.restoreHoldForOrder(manager, storeId, orderId),
      );
      if (restored > 0) {
        ordersTouched += 1;
        itemsRestored += restored;
        // After commit: best-effort resume notify (ADR-0010).
        try {
          await this.notificationsService.notifyOrderItemsHoldResumed(orderId, storeId);
        } catch (error) {
          this.logger.warn(
            `Hold resume notification failed for store=${storeId} order=${orderId}`,
            error instanceof Error ? error.message : undefined,
          );
        }
      }
    }

    return { ordersTouched, itemsRestored };
  }

  /**
   * 30-day hold SLA: cancel expired on_hold items only; item-scoped stock restore; no refund.
   * Decision #16: recompute payable totals when unpaid siblings remain.
   */
  async cancelExpiredHeldItems(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.getHoldSlaAfterMs());
    const expiredItems = await this.orderItemRepository.find({
      where: {
        fulfillmentStatus: FulfillmentStatus.ON_HOLD,
        holdStartedAt: LessThanOrEqual(cutoff),
      },
    });

    const orderIds = [...new Set(expiredItems.map((item) => item.orderId))];
    let cancelledCount = 0;

    for (const orderId of orderIds) {
      try {
        const cancelled = await this.dataSource.transaction((manager) =>
          this.cancelExpiredHeldItemsForOrder(manager, orderId, cutoff),
        );
        cancelledCount += cancelled;
      } catch (error) {
        this.logger.error(
          `cancelExpiredHeldItems failed for order=${orderId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (cancelledCount > 0) {
      this.logger.log(`Hold SLA cancelled ${cancelledCount} expired held item(s)`);
    }

    return cancelledCount;
  }

  private async cancelExpiredHeldItemsForOrder(
    manager: EntityManager,
    orderId: string,
    cutoff: Date,
  ): Promise<number> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      relations: ['items', 'storeShippings'],
    });
    if (!order || !order.items?.length) {
      return 0;
    }

    const expiredHeld = order.items.filter(
      (item) =>
        item.fulfillmentStatus === FulfillmentStatus.ON_HOLD &&
        item.holdStartedAt != null &&
        item.holdStartedAt.getTime() <= cutoff.getTime(),
    );
    if (expiredHeld.length === 0) {
      return 0;
    }

    const now = new Date();
    const cancelledIds: string[] = [];

    for (const item of expiredHeld) {
      item.fulfillmentStatus = FulfillmentStatus.CANCELLED;
      item.previousFulfillmentStatus = null;
      item.holdStartedAt = null;
      item.updatedAt = now;
      cancelledIds.push(item.id);
    }

    await manager.save(OrderItem, expiredHeld);

    await this.inventoryService.restoreItemStock(
      orderId,
      cancelledIds,
      manager,
      'Hold SLA auto-cancel stock restore',
    );

    for (const itemId of cancelledIds) {
      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId,
          status: order.status,
          changedBy: null,
          notes: `Hold SLA auto-cancel item ${itemId}`,
        }),
      );
    }

    const previousStatus = order.status;
    const nextStatus = deriveOrderStatusFromFulfillment(
      order.status,
      order.items.map((item) => item.fulfillmentStatus),
    );

    if (order.previousStatus != null && nextStatus !== OrderStatus.ON_HOLD) {
      order.previousStatus = null;
    }

    if (nextStatus === OrderStatus.PENDING_PAYMENT) {
      recomputeOrderPayableTotals(order);
    }

    order.status = nextStatus;
    await manager.save(Order, order);

    if (nextStatus !== previousStatus) {
      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId,
          status: nextStatus,
          changedBy: null,
          notes: `Hold SLA cancelled ${cancelledIds.length} held item(s); order status ${previousStatus} → ${nextStatus}`,
        }),
      );
    }

    return cancelledIds.length;
  }

  private async findOrderIdsWithEligibleItems(storeId: string): Promise<string[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'ord')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('item.fulfillmentStatus IN (:...fulfillmentStatuses)', {
        fulfillmentStatuses: [...HOLD_ELIGIBLE_FULFILLMENT],
      })
      .andWhere('ord.status IN (:...orderStatuses)', {
        orderStatuses: [...HOLD_ELIGIBLE_ORDER_STATUSES],
      })
      .select('DISTINCT item.orderId', 'orderId')
      .getRawMany<{ orderId: string }>();

    return rows.map((row) => row.orderId);
  }

  private async findOrderIdsWithHeldItems(storeId: string): Promise<string[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('item')
      .where('item.storeId = :storeId', { storeId })
      .andWhere('item.fulfillmentStatus = :status', { status: FulfillmentStatus.ON_HOLD })
      .select('DISTINCT item.orderId', 'orderId')
      .getRawMany<{ orderId: string }>();

    return rows.map((row) => row.orderId);
  }

  private async applyHoldForOrder(
    manager: EntityManager,
    storeId: string,
    orderId: string,
  ): Promise<number> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order || !order.items?.length) {
      return 0;
    }
    if (!HOLD_ELIGIBLE_ORDER_STATUSES.has(order.status)) {
      return 0;
    }

    const now = new Date();
    let heldCount = 0;
    const itemsToSave: OrderItem[] = [];

    for (const item of order.items) {
      if (item.storeId !== storeId) {
        continue;
      }
      if (item.fulfillmentStatus === FulfillmentStatus.ON_HOLD) {
        // Idempotent: keep existing snapshot; do not overwrite.
        continue;
      }
      if (!HOLD_ELIGIBLE_FULFILLMENT.has(item.fulfillmentStatus)) {
        continue;
      }

      item.previousFulfillmentStatus = item.fulfillmentStatus;
      item.holdStartedAt = now;
      item.fulfillmentStatus = FulfillmentStatus.ON_HOLD;
      itemsToSave.push(item);
      heldCount += 1;
    }

    if (heldCount === 0) {
      return 0;
    }

    await manager.save(OrderItem, itemsToSave);

    const previousStatus = order.status;
    const nextStatus = deriveOrderStatusFromFulfillment(
      order.status,
      order.items.map((item) => item.fulfillmentStatus),
    );

    if (nextStatus !== previousStatus) {
      if (nextStatus === OrderStatus.ON_HOLD) {
        order.previousStatus = previousStatus;
      }
      order.status = nextStatus;
      await manager.save(Order, order);
    }

    await manager.save(
      OrderStatusHistory,
      manager.create(OrderStatusHistory, {
        orderId: order.id,
        status: order.status,
        changedBy: null,
        notes: `Store suspension hold applied for store ${storeId} (${heldCount} item(s))`,
      }),
    );

    return heldCount;
  }

  private async restoreHoldForOrder(
    manager: EntityManager,
    storeId: string,
    orderId: string,
  ): Promise<number> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      relations: ['items'],
    });
    if (!order || !order.items?.length) {
      return 0;
    }

    const heldItems = order.items.filter(
      (item) => item.storeId === storeId && item.fulfillmentStatus === FulfillmentStatus.ON_HOLD,
    );
    if (heldItems.length === 0) {
      return 0;
    }

    for (const item of heldItems) {
      if (item.previousFulfillmentStatus == null) {
        throw new BadRequestException({
          code: 'HOLD_RESTORE_SNAPSHOT_MISSING',
          message: `Cannot restore hold for item ${item.id}: previous_fulfillment_status is missing`,
        });
      }
    }

    for (const item of heldItems) {
      item.fulfillmentStatus = item.previousFulfillmentStatus!;
      item.previousFulfillmentStatus = null;
      item.holdStartedAt = null;
    }

    await manager.save(OrderItem, heldItems);

    const previousOrderStatus = order.status;
    const nextStatus = deriveOrderStatusFromFulfillment(
      order.status,
      order.items.map((item) => item.fulfillmentStatus),
    );

    if (order.previousStatus != null && nextStatus !== OrderStatus.ON_HOLD) {
      order.previousStatus = null;
    }

    const clearedOrderSnapshot =
      previousOrderStatus === OrderStatus.ON_HOLD && order.previousStatus === null;

    if (nextStatus !== previousOrderStatus || clearedOrderSnapshot) {
      order.status = nextStatus;
      await manager.save(Order, order);
    }

    if (nextStatus !== previousOrderStatus) {
      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          status: nextStatus,
          changedBy: null,
          notes: `Store reactivation restored hold for store ${storeId}`,
        }),
      );
    }

    return heldItems.length;
  }
}
