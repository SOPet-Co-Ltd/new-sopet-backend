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

/** Serialize order-line snapshot options (never recompute from live ProductVariant). */
export function serializeVariantOptions(
  variantOptions: Record<string, string> | null | undefined,
): string {
  return JSON.stringify(variantOptions ?? {});
}

/**
 * @param viewerStoreId When set, the caller is a vendor viewing a (possibly multi-vendor)
 * order for this store only. Items belonging to *other* stores on the same order are
 * redacted down to just `id`/`storeId` - vendors are not entitled to see another store's
 * product identity, pricing, quantities, or shipment details, even though the order-level
 * `storeId` set is still needed client-side (e.g. to detect/display "this order also has
 * items from other stores" context and multi-store discount proration).
 */
export function mapOrderItem(item: OrderItem, viewerStoreId?: string) {
  if (viewerStoreId && item.storeId !== viewerStoreId) {
    return {
      id: item.id,
      storeId: item.storeId,
      variantId: '',
      productName: '',
      productId: null,
      productImageUrl: null,
      variantOptions: '{}',
      unitPrice: 0,
      catalogUnitPrice: null,
      saleCampaignId: null,
      saleDiscountPercent: null,
      quantity: 0,
      subtotal: 0,
      fulfillmentStatus: '',
      trackingNumber: null,
      fulfillmentProvider: null,
      trackingUrl: null,
    };
  }

  const productId = item.productVariant?.productId ?? null;

  return {
    id: item.id,
    storeId: item.storeId,
    variantId: item.variantId,
    productName: item.productName,
    productId,
    productImageUrl: productId ? resolveOrderItemImageUrl(item) : null,
    variantOptions: serializeVariantOptions(item.variantOptions),
    unitPrice: Number(item.unitPrice),
    catalogUnitPrice: item.catalogUnitPrice != null ? Number(item.catalogUnitPrice) : null,
    saleCampaignId: item.saleCampaignId ?? null,
    saleDiscountPercent:
      item.saleDiscountPercent != null ? Number(item.saleDiscountPercent) : null,
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
    variantOptions: serializeVariantOptions(item.variantOptions),
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

/**
 * @param viewerStoreId When set, maps this order for a vendor viewing it as one of
 * possibly several stores on the order. Order-level aggregates (subtotal/total/etc.) are
 * intentionally left as whole-order figures - the admin UI already relies on these plus
 * the (redacted-safe) per-item `storeId` set to show "this order also includes other
 * stores" context and proration. See `mapOrderItem` for per-item redaction rules.
 */
export function mapOrder(order: Order, viewerStoreId?: string): OrderType {
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
      order.storeShippings?.map((shipping) =>
        viewerStoreId && shipping.storeId !== viewerStoreId
          ? { storeId: shipping.storeId, optionName: '', shippingFee: 0 }
          : {
              storeId: shipping.storeId,
              optionName: shipping.optionName,
              shippingFee: Number(shipping.shippingFee),
            },
      ) ?? [],
    items: order.items?.map((item) => mapOrderItem(item, viewerStoreId)) ?? [],
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
