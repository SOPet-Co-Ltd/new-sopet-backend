import { OrderStatus } from '../../database/entities/enums/order.enums';
import { VENDOR_WEBHOOK_EVENTS } from '../../database/entities/store-webhook.entity';
import { DEFAULT_VENDOR_WEBHOOK_EVENTS, webhookEventForOrderStatus } from './vendor-webhook.events';

describe('vendor-webhook.events', () => {
  it('includes the full automation event set by default', () => {
    expect(DEFAULT_VENDOR_WEBHOOK_EVENTS).toEqual([...VENDOR_WEBHOOK_EVENTS]);
    expect(VENDOR_WEBHOOK_EVENTS).toEqual([
      'order.create',
      'order.payment_failed',
      'order.paid',
      'order.processing',
      'order.on_hold',
      'order.shipped',
      'order.delivered',
      'order.cancelled',
      'order.refunded',
    ]);
  });

  it('maps order statuses to webhook events', () => {
    expect(webhookEventForOrderStatus(OrderStatus.PAID)).toBe('order.paid');
    expect(webhookEventForOrderStatus(OrderStatus.PROCESSING)).toBe('order.processing');
    expect(webhookEventForOrderStatus(OrderStatus.ON_HOLD)).toBe('order.on_hold');
    expect(webhookEventForOrderStatus(OrderStatus.SHIPPED)).toBe('order.shipped');
    expect(webhookEventForOrderStatus(OrderStatus.DELIVERED)).toBe('order.delivered');
    expect(webhookEventForOrderStatus(OrderStatus.CANCELLED)).toBe('order.cancelled');
    expect(webhookEventForOrderStatus(OrderStatus.REFUNDED)).toBe('order.refunded');
    expect(webhookEventForOrderStatus(OrderStatus.PENDING_PAYMENT)).toBeNull();
  });
});
