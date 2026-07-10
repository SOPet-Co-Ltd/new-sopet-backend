import { OrderStatus } from '../../database/entities/enums/order.enums';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import {
  deriveOrderStatusFromFulfillment,
  validateOptionalTrackingUrl,
  validateTrackingUrl,
} from './order-fulfillment.util';

describe('validateOptionalTrackingUrl', () => {
  it('accepts https URLs', () => {
    expect(validateOptionalTrackingUrl('https://track.example.com/abc')).toBe(
      'https://track.example.com/abc',
    );
  });

  it('returns null for empty input', () => {
    expect(validateOptionalTrackingUrl('')).toBeNull();
    expect(validateOptionalTrackingUrl('   ')).toBeNull();
  });

  it('rejects non-https URLs', () => {
    expect(() => validateOptionalTrackingUrl('http://track.example.com/abc')).toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => validateOptionalTrackingUrl('not-a-url')).toThrow();
  });
});

describe('validateTrackingUrl', () => {
  it('accepts https URLs', () => {
    expect(validateTrackingUrl('https://track.example.com/abc')).toBe(
      'https://track.example.com/abc',
    );
  });

  it('rejects empty URLs', () => {
    expect(() => validateTrackingUrl('')).toThrow();
  });

  it('rejects non-https URLs', () => {
    expect(() => validateTrackingUrl('http://track.example.com/abc')).toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => validateTrackingUrl('not-a-url')).toThrow();
  });
});

describe('deriveOrderStatusFromFulfillment', () => {
  it('keeps pending payment until paid', () => {
    expect(
      deriveOrderStatusFromFulfillment(OrderStatus.PENDING_PAYMENT, [FulfillmentStatus.PENDING]),
    ).toBe(OrderStatus.PENDING_PAYMENT);
  });

  it('returns paid when all items are pending after payment', () => {
    expect(deriveOrderStatusFromFulfillment(OrderStatus.PAID, [FulfillmentStatus.PENDING])).toBe(
      OrderStatus.PAID,
    );
  });

  it('returns processing when any item is processing', () => {
    expect(
      deriveOrderStatusFromFulfillment(OrderStatus.PAID, [
        FulfillmentStatus.PROCESSING,
        FulfillmentStatus.PENDING,
      ]),
    ).toBe(OrderStatus.PROCESSING);
  });

  it('returns shipped only when all items are shipped', () => {
    expect(
      deriveOrderStatusFromFulfillment(OrderStatus.PROCESSING, [
        FulfillmentStatus.SHIPPED,
        FulfillmentStatus.PENDING,
      ]),
    ).toBe(OrderStatus.PROCESSING);

    expect(
      deriveOrderStatusFromFulfillment(OrderStatus.PROCESSING, [
        FulfillmentStatus.SHIPPED,
        FulfillmentStatus.SHIPPED,
      ]),
    ).toBe(OrderStatus.SHIPPED);
  });

  it('returns delivered when all items are delivered', () => {
    expect(
      deriveOrderStatusFromFulfillment(OrderStatus.SHIPPED, [
        FulfillmentStatus.DELIVERED,
        FulfillmentStatus.DELIVERED,
      ]),
    ).toBe(OrderStatus.DELIVERED);
  });
});
