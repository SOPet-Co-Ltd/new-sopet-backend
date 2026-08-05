import { OrderStatus } from '../../database/entities/enums/order.enums';
import {
  VENDOR_WEBHOOK_EVENTS,
  VendorWebhookEvent,
} from '../../database/entities/store-webhook.entity';

/** Default subscription when a store configures a webhook without an events list. */
export const DEFAULT_VENDOR_WEBHOOK_EVENTS: VendorWebhookEvent[] = [...VENDOR_WEBHOOK_EVENTS];

/**
 * Map order header status transitions to vendor webhook events.
 * `order.create` and `order.payment_failed` are fired from dedicated paths (not status maps).
 */
export function webhookEventForOrderStatus(status: OrderStatus): VendorWebhookEvent | null {
  switch (status) {
    case OrderStatus.PAID:
      return 'order.paid';
    case OrderStatus.PROCESSING:
      return 'order.processing';
    case OrderStatus.ON_HOLD:
      return 'order.on_hold';
    case OrderStatus.SHIPPED:
      return 'order.shipped';
    case OrderStatus.DELIVERED:
      return 'order.delivered';
    case OrderStatus.CANCELLED:
      return 'order.cancelled';
    case OrderStatus.REFUNDED:
      return 'order.refunded';
    case OrderStatus.PENDING_PAYMENT:
      return null;
    default:
      return null;
  }
}
