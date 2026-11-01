import { OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { isVendorOrderActionable } from './vendor-order-action-queue.util';

const STORE = 'store-1';
const OTHER = 'store-2';

function order(partial: {
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  items: Array<{ storeId: string; fulfillmentStatus: FulfillmentStatus | string }>;
}) {
  return {
    status: partial.status,
    paymentMethod: partial.paymentMethod ?? PaymentMethod.PROMPTPAY,
    items: partial.items,
  };
}

describe('isVendorOrderActionable', () => {
  it('marks unpaid non-bank-transfer orders as actionable (mark_paid)', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PENDING_PAYMENT,
          items: [{ storeId: STORE, fulfillmentStatus: FulfillmentStatus.PENDING }],
        }),
        STORE,
      ),
    ).toBe(true);
  });

  it('excludes pending bank_transfer (platform confirms)', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PENDING_PAYMENT,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          items: [{ storeId: STORE, fulfillmentStatus: FulfillmentStatus.PENDING }],
        }),
        STORE,
      ),
    ).toBe(false);
  });

  it('marks paid / pending-fulfillment as actionable (acknowledge)', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PAID,
          items: [{ storeId: STORE, fulfillmentStatus: FulfillmentStatus.PENDING }],
        }),
        STORE,
      ),
    ).toBe(true);
  });

  it('marks all-processing store items as actionable (ship)', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PROCESSING,
          items: [
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.PROCESSING },
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.PROCESSING },
          ],
        }),
        STORE,
      ),
    ).toBe(true);
  });

  it('excludes delivered / cancelled / refunded / on_hold order status', () => {
    for (const status of [
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.REFUNDED,
      OrderStatus.ON_HOLD,
    ]) {
      expect(
        isVendorOrderActionable(
          order({
            status,
            items: [{ storeId: STORE, fulfillmentStatus: FulfillmentStatus.PENDING }],
          }),
          STORE,
        ),
      ).toBe(false);
    }
  });

  it('excludes held-only store items', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PAID,
          items: [
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.ON_HOLD },
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.SHIPPED },
          ],
        }),
        STORE,
      ),
    ).toBe(false);
  });

  it('excludes all shipped/delivered (awaiting_customer / completed)', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.SHIPPED,
          items: [
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.SHIPPED },
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.DELIVERED },
          ],
        }),
        STORE,
      ),
    ).toBe(false);

    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PROCESSING,
          items: [{ storeId: STORE, fulfillmentStatus: FulfillmentStatus.DELIVERED }],
        }),
        STORE,
      ),
    ).toBe(false);
  });

  it('ignores other-store items when deciding actionability', () => {
    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PAID,
          items: [
            { storeId: OTHER, fulfillmentStatus: FulfillmentStatus.PENDING },
            { storeId: STORE, fulfillmentStatus: FulfillmentStatus.SHIPPED },
          ],
        }),
        STORE,
      ),
    ).toBe(false);

    expect(
      isVendorOrderActionable(
        order({
          status: OrderStatus.PAID,
          items: [{ storeId: OTHER, fulfillmentStatus: FulfillmentStatus.PENDING }],
        }),
        STORE,
      ),
    ).toBe(false);
  });
});
