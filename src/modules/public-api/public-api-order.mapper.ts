import { Order } from '../../database/entities/order.entity';

/** Store-scoped order snapshot for public API list + tracking responses. */
export function mapPublicApiOrder(order: Order, storeId: string) {
  const items = (order.items ?? []).filter((item) => item.storeId === storeId);
  const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const address = order.shippingAddress;
  const customerName = order.customer?.fullName ?? order.guestName ?? address?.fullName ?? null;
  const customerPhone = order.customer?.phone ?? order.guestPhone ?? address?.phone ?? null;
  const customerEmail = order.customer?.email ?? order.guestEmail ?? null;

  return {
    id: order.id,
    /** Same as `id` — use this (or `id`) as `{orderId}` in PATCH tracking. */
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
    currency: 'THB' as const,
    customer: {
      name: customerName,
      phone: customerPhone,
      email: customerEmail,
    },
    shippingAddress: address
      ? {
          fullName: address.fullName,
          phone: address.phone,
          addressLine1: address.addressLine1,
          addressLine2: address.addressLine2,
          tumbon: address.tumbon,
          amphoe: address.amphoe,
          province: address.province,
          postalCode: address.postalCode,
        }
      : null,
    items: items.map((item) => ({
      id: item.id,
      productName: item.productName,
      sku: item.productVariant?.sku ?? null,
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
    itemsSubtotal,
    createdAt: new Date(order.createdAt).toISOString(),
    updatedAt: new Date(order.updatedAt).toISOString(),
  };
}
