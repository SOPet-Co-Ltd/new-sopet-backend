import { Order } from '../../database/entities/order.entity';

/** Store-scoped order snapshot for public API tracking responses. */
export function mapPublicApiOrder(order: Order, storeId: string) {
  const items = (order.items ?? []).filter((item) => item.storeId === storeId);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    items: items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantId: item.variantId,
      variantOptions: item.variantOptions ?? {},
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
      fulfillmentStatus: item.fulfillmentStatus,
      trackingNumber: item.trackingNumber,
      fulfillmentProvider: item.fulfillmentProvider,
      trackingUrl: item.trackingUrl,
      shippedAt: item.shippedAt ? new Date(item.shippedAt).toISOString() : null,
    })),
    updatedAt: new Date(order.updatedAt).toISOString(),
  };
}
