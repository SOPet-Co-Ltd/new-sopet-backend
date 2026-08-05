import { createHmac, randomUUID } from 'node:crypto';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { VendorWebhookEvent } from '../../database/entities/store-webhook.entity';

export type VendorWebhookOrderPayload = {
  id: string;
  event: VendorWebhookEvent;
  createdAt: string;
  storeId: string;
  data: {
    orderId: string;
    orderNumber: string;
    status: string;
    paymentMethod: string;
    paidAt: string | null;
    currency: 'THB';
    customer: {
      name: string | null;
      phone: string | null;
      email: string | null;
    };
    shippingAddress: {
      fullName: string;
      phone: string;
      addressLine1: string;
      addressLine2: string | null;
      tumbon: string | null;
      amphoe: string;
      province: string;
      postalCode: string;
    } | null;
    items: Array<{
      id: string;
      productName: string;
      sku: string | null;
      variantId: string;
      variantOptions: Record<string, string>;
      quantity: number;
      unitPrice: number;
      subtotal: number;
      fulfillmentStatus: string;
      trackingNumber: string | null;
      fulfillmentProvider: string | null;
    }>;
    itemsSubtotal: number;
    createdAt: string;
  };
};

function storeItems(order: Order, storeId: string): OrderItem[] {
  return (order.items ?? []).filter((item) => item.storeId === storeId);
}

export function buildVendorWebhookOrderPayload(
  order: Order,
  storeId: string,
  event: VendorWebhookEvent,
): VendorWebhookOrderPayload | null {
  const items = storeItems(order, storeId);
  if (items.length === 0) {
    return null;
  }

  const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.subtotal), 0);
  const address = order.shippingAddress;
  const customerName = order.customer?.fullName ?? order.guestName ?? address?.fullName ?? null;
  const customerPhone = order.customer?.phone ?? order.guestPhone ?? address?.phone ?? null;
  const customerEmail = order.customer?.email ?? order.guestEmail ?? null;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    event,
    createdAt: new Date().toISOString(),
    storeId,
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paidAt: order.paidAt ? new Date(order.paidAt).toISOString() : null,
      currency: 'THB',
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
      })),
      itemsSubtotal,
      createdAt: new Date(order.createdAt).toISOString(),
    },
  };
}

export function signVendorWebhookPayload(secret: string, payloadJson: string): string {
  const digest = createHmac('sha256', secret).update(payloadJson, 'utf8').digest('hex');
  return `sha256=${digest}`;
}
