import { Order } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { OrderStoreShipping } from '../../database/entities/order-store-shipping.entity';

/**
 * Decision #16: after cancelling held unpaid lines, recompute subtotal / shippingFee / total
 * from remaining non-cancelled items + store shipping for stores that still have items.
 */
export function recomputeOrderPayableTotals(order: Order): void {
  const items = order.items ?? [];
  const remainingItems = items.filter(
    (item) => item.fulfillmentStatus !== FulfillmentStatus.CANCELLED,
  );
  const remainingStoreIds = new Set(remainingItems.map((item) => item.storeId));

  const subtotal = remainingItems.reduce(
    (sum, item) => sum + Number(item.subtotal ?? Number(item.unitPrice) * item.quantity),
    0,
  );

  const storeShippings: OrderStoreShipping[] = order.storeShippings ?? [];
  const shippingFee = storeShippings
    .filter((shipping) => remainingStoreIds.has(shipping.storeId))
    .reduce((sum, shipping) => sum + Number(shipping.shippingFee), 0);

  const discountAmount = Number(order.discountAmount ?? 0);
  order.subtotal = subtotal;
  order.shippingFee = shippingFee;
  order.total = Math.max(0, subtotal + shippingFee - discountAmount);
}

export function orderHasHeldItems(items: OrderItem[] | undefined): boolean {
  return (items ?? []).some((item) => item.fulfillmentStatus === FulfillmentStatus.ON_HOLD);
}
