import { OrderTrackingItemType, OrderTrackingType, OrderType } from '../../graphql/models/types';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductImage } from '../../database/entities/product-image.entity';

export function resolveOrderItemImageUrl(item: OrderItem): string | null {
  const variant = item.productVariant;
  if (!variant) {
    return null;
  }

  if (variant.imageUrl) {
    return variant.imageUrl;
  }

  const images = variant.product?.images as ProductImage[] | undefined;
  if (!images?.length) {
    return null;
  }

  const thumbnail = images.find((image) => image.isThumbnail) ?? images[0];
  return thumbnail?.url ?? null;
}

export function mapOrderItem(item: OrderItem) {
  const productId = item.productVariant?.productId ?? null;

  return {
    id: item.id,
    storeId: item.storeId,
    variantId: item.variantId,
    productName: item.productName,
    productId,
    productImageUrl: productId ? resolveOrderItemImageUrl(item) : null,
    unitPrice: Number(item.unitPrice),
    quantity: item.quantity,
    subtotal: Number(item.subtotal),
    fulfillmentStatus: item.fulfillmentStatus,
    trackingNumber: item.trackingNumber ?? null,
    fulfillmentProvider: item.fulfillmentProvider ?? null,
    trackingUrl: item.trackingUrl ?? null,
  };
}

export function mapOrderTrackingItem(item: OrderItem): OrderTrackingItemType {
  const productId = item.productVariant?.productId ?? null;

  return {
    storeId: item.storeId,
    productId,
    productName: item.productName,
    productImageUrl: productId ? resolveOrderItemImageUrl(item) : null,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
    subtotal: Number(item.subtotal),
    fulfillmentStatus: item.fulfillmentStatus,
    trackingNumber: item.trackingNumber ?? null,
    fulfillmentProvider: item.fulfillmentProvider ?? null,
    trackingUrl: item.trackingUrl ?? null,
  };
}

export function mapOrderTracking(order: Order): OrderTrackingType {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    subtotal: Number(order.subtotal),
    shippingFee: Number(order.shippingFee),
    discountAmount: Number(order.discountAmount),
    total: Number(order.total),
    items: order.items?.map(mapOrderTrackingItem) ?? [],
    storeShippings:
      order.storeShippings?.map((shipping) => ({
        storeId: shipping.storeId,
        optionName: shipping.optionName,
        shippingFee: Number(shipping.shippingFee),
      })) ?? [],
  };
}

export function mapOrder(order: Order): OrderType {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: Number(order.subtotal),
    shippingFee: Number(order.shippingFee),
    discountAmount: Number(order.discountAmount),
    total: Number(order.total),
    paymentMethod: order.paymentMethod,
    guestPhone: order.guestPhone ?? null,
    guestName: order.guestName ?? null,
    guestEmail: order.guestEmail ?? null,
    createdAt: order.createdAt,
    storeShippings:
      order.storeShippings?.map((shipping) => ({
        storeId: shipping.storeId,
        optionName: shipping.optionName,
        shippingFee: Number(shipping.shippingFee),
      })) ?? [],
    items: order.items?.map(mapOrderItem) ?? [],
    shippingAddress: order.shippingAddress
      ? {
          fullName: order.shippingAddress.fullName,
          phone: order.shippingAddress.phone,
          addressLine1: order.shippingAddress.addressLine1,
          addressLine2: order.shippingAddress.addressLine2,
          tumbon: order.shippingAddress.tumbon,
          amphoe: order.shippingAddress.amphoe,
          province: order.shippingAddress.province,
          postalCode: order.shippingAddress.postalCode,
        }
      : null,
  };
}
