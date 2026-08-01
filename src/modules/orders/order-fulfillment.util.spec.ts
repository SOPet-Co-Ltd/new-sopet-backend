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

  /**
   * Early verification matrix — Design Doc §2 / Decision #15 / AC-011–AC-012.
   * Held peers must not invent shipped|delivered; unpaid must not elevate to order on_hold.
   */
  it.each([
    {
      name: 'Decision #15: unpaid + all on_hold stays pending_payment (not order on_hold)',
      current: OrderStatus.PENDING_PAYMENT,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.ON_HOLD],
      expected: OrderStatus.PENDING_PAYMENT,
    },
    {
      name: 'Decision #15: unpaid + mixed held + pending stays pending_payment',
      current: OrderStatus.PENDING_PAYMENT,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.PENDING],
      expected: OrderStatus.PENDING_PAYMENT,
    },
    {
      name: 'AC-011: paid + all non-terminal on_hold → order on_hold',
      current: OrderStatus.PAID,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.ON_HOLD],
      expected: OrderStatus.ON_HOLD,
    },
    {
      name: 'AC-011: processing + all on_hold → order on_hold',
      current: OrderStatus.PROCESSING,
      statuses: [FulfillmentStatus.ON_HOLD],
      expected: OrderStatus.ON_HOLD,
    },
    {
      name: 'AC-011: paid + cancelled terminal excluded; remaining all on_hold → on_hold',
      current: OrderStatus.PAID,
      statuses: [FulfillmentStatus.CANCELLED, FulfillmentStatus.ON_HOLD],
      expected: OrderStatus.ON_HOLD,
    },
    {
      name: 'AC-012: mixed held + pending → paid (not on_hold; held ignored for ladder)',
      current: OrderStatus.PAID,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.PENDING],
      expected: OrderStatus.PAID,
    },
    {
      name: 'AC-012: mixed held + processing → processing',
      current: OrderStatus.PAID,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.PROCESSING],
      expected: OrderStatus.PROCESSING,
    },
    {
      name: 'mixed held + shipped + pending → processing (not shipped/delivered)',
      current: OrderStatus.PROCESSING,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.SHIPPED, FulfillmentStatus.PENDING],
      expected: OrderStatus.PROCESSING,
    },
    {
      name: 'mixed held + shipped sibling → shipped (not delivered; held excluded from every)',
      current: OrderStatus.PROCESSING,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.SHIPPED],
      expected: OrderStatus.SHIPPED,
    },
    {
      name: 'held peers do not block all-shipped progressing set → shipped',
      current: OrderStatus.PROCESSING,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.SHIPPED, FulfillmentStatus.SHIPPED],
      expected: OrderStatus.SHIPPED,
    },
    {
      name: 'held peers do not block all-delivered progressing set → delivered',
      current: OrderStatus.SHIPPED,
      statuses: [
        FulfillmentStatus.ON_HOLD,
        FulfillmentStatus.DELIVERED,
        FulfillmentStatus.DELIVERED,
      ],
      expected: OrderStatus.DELIVERED,
    },
    {
      name: 'never treat on_hold as processing for some() ladder alone',
      current: OrderStatus.PAID,
      statuses: [FulfillmentStatus.ON_HOLD, FulfillmentStatus.PENDING],
      expected: OrderStatus.PAID,
    },
  ])('$name', ({ current, statuses, expected }) => {
    expect(deriveOrderStatusFromFulfillment(current, statuses)).toBe(expected);
  });
});
