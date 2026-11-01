import { registerEnumType } from '@nestjs/graphql';
import { SelectQueryBuilder } from 'typeorm';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';

export enum VendorOrderQueueFilter {
  ALL = 'ALL',
  ACTION = 'ACTION',
}

registerEnumType(VendorOrderQueueFilter, {
  name: 'VendorOrderQueueFilter',
});

export const DEFAULT_VENDOR_ORDERS_PAGE = 1;
export const DEFAULT_VENDOR_ORDERS_LIMIT = 20;
export const MAX_VENDOR_ORDERS_LIMIT = 50;

/** Valid fulfillment_status_enum values only — never bind non-enum strings into SQL. */
const TERMINAL_FULFILLMENT: ReadonlySet<string> = new Set([
  FulfillmentStatus.SHIPPED,
  FulfillmentStatus.DELIVERED,
  FulfillmentStatus.CANCELLED,
]);

/**
 * Mirrors admin `isVendorActionableOrder` / `getVendorOrderWorkflowAction` for
 * mark_paid | acknowledge | ship. Used in unit tests to lock SQL predicate intent.
 */
export function isVendorOrderActionable(
  order: {
    status: string;
    paymentMethod: string;
    items: Array<{ storeId: string; fulfillmentStatus: string }>;
  },
  storeId: string,
): boolean {
  const storeItems = order.items.filter((item) => item.storeId === storeId);
  if (storeItems.length === 0) {
    return false;
  }

  if (
    order.status === 'cancelled' ||
    order.status === 'refunded' ||
    order.status === 'delivered' ||
    order.status === 'on_hold'
  ) {
    return false;
  }

  const fulfillmentStatuses = storeItems.map((item) => item.fulfillmentStatus);
  const nonTerminal = fulfillmentStatuses.filter((status) => !TERMINAL_FULFILLMENT.has(status));
  if (nonTerminal.length > 0 && nonTerminal.every((status) => status === 'on_hold')) {
    return false;
  }

  if (order.status === 'pending_payment') {
    return order.paymentMethod !== 'bank_transfer';
  }

  if (fulfillmentStatuses.every((status) => status === 'delivered')) {
    return false;
  }

  if (fulfillmentStatuses.every((status) => status === 'shipped' || status === 'delivered')) {
    return false;
  }

  if (fulfillmentStatuses.every((status) => status === 'processing')) {
    return true;
  }

  if (
    order.status === 'paid' ||
    order.status === 'processing' ||
    fulfillmentStatuses.every((status) => status === 'pending')
  ) {
    return true;
  }

  return false;
}

/**
 * Restricts an order id-query to vendor action-queue rows for `storeId`.
 * Must stay in sync with `isVendorOrderActionable`.
 */
export function applyVendorActionQueueFilter(qb: SelectQueryBuilder<Order>, storeId: string): void {
  const terminal = [...TERMINAL_FULFILLMENT];

  qb.andWhere('order.status NOT IN (:...nonActionableStatuses)', {
    nonActionableStatuses: [
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.DELIVERED,
      OrderStatus.ON_HOLD,
    ],
  });

  // Not held-only: no non-terminal store items, or some non-terminal item is not on_hold.
  qb.andWhere(
    `(
      NOT EXISTS (
        SELECT 1 FROM order_items held_nt
        WHERE held_nt.order_id = "order"."id"
          AND held_nt.store_id = :actionStoreId
          AND held_nt.fulfillment_status NOT IN (:...terminalFulfillment)
      )
      OR EXISTS (
        SELECT 1 FROM order_items held_open
        WHERE held_open.order_id = "order"."id"
          AND held_open.store_id = :actionStoreId
          AND held_open.fulfillment_status NOT IN (:...terminalFulfillment)
          AND held_open.fulfillment_status <> :onHoldStatus
      )
    )`,
    {
      actionStoreId: storeId,
      terminalFulfillment: terminal,
      onHoldStatus: FulfillmentStatus.ON_HOLD,
    },
  );

  qb.andWhere(
    `(
      (
        "order"."status" = :pendingPaymentStatus
        AND "order"."payment_method" <> :bankTransferMethod
      )
      OR (
        "order"."status" <> :pendingPaymentStatus
        AND (
          NOT EXISTS (
            SELECT 1 FROM order_items ship_oi
            WHERE ship_oi.order_id = "order"."id"
              AND ship_oi.store_id = :actionStoreId
              AND ship_oi.fulfillment_status <> :processingStatus
          )
          OR (
            (
              "order"."status" IN (:...ackOrderStatuses)
              OR NOT EXISTS (
                SELECT 1 FROM order_items pend_oi
                WHERE pend_oi.order_id = "order"."id"
                  AND pend_oi.store_id = :actionStoreId
                  AND pend_oi.fulfillment_status <> :pendingStatus
              )
            )
            AND EXISTS (
              SELECT 1 FROM order_items open_oi
              WHERE open_oi.order_id = "order"."id"
                AND open_oi.store_id = :actionStoreId
                AND open_oi.fulfillment_status NOT IN (:...shippedOrDelivered)
            )
          )
        )
      )
    )`,
    {
      pendingPaymentStatus: OrderStatus.PENDING_PAYMENT,
      bankTransferMethod: PaymentMethod.BANK_TRANSFER,
      processingStatus: FulfillmentStatus.PROCESSING,
      pendingStatus: FulfillmentStatus.PENDING,
      ackOrderStatuses: [OrderStatus.PAID, OrderStatus.PROCESSING],
      shippedOrDelivered: [FulfillmentStatus.SHIPPED, FulfillmentStatus.DELIVERED],
    },
  );
}

export function normalizeVendorOrdersPage(page?: number): number {
  return Math.max(page ?? DEFAULT_VENDOR_ORDERS_PAGE, 1);
}

export function normalizeVendorOrdersLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_VENDOR_ORDERS_LIMIT, 1), MAX_VENDOR_ORDERS_LIMIT);
}
