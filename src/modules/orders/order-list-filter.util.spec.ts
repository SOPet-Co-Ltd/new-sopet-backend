import {
  CustomerOrderListFilter,
  statusesForCustomerOrderListFilter,
} from './order-list-filter.util';

describe('order-list-filter.util', () => {
  describe('statusesForCustomerOrderListFilter', () => {
    it('returns null for ALL', () => {
      expect(statusesForCustomerOrderListFilter(CustomerOrderListFilter.ALL)).toBeNull();
    });

    it('maps PENDING_PAYMENT to pending_payment', () => {
      expect(statusesForCustomerOrderListFilter(CustomerOrderListFilter.PENDING_PAYMENT)).toEqual([
        'pending_payment',
      ]);
    });

    it('maps IN_PROGRESS to active fulfillment statuses', () => {
      expect(statusesForCustomerOrderListFilter(CustomerOrderListFilter.IN_PROGRESS)).toEqual([
        'paid',
        'processing',
        'shipped',
      ]);
    });

    it('maps DELIVERED', () => {
      expect(statusesForCustomerOrderListFilter(CustomerOrderListFilter.DELIVERED)).toEqual([
        'delivered',
      ]);
    });

    it('maps CANCELLED to cancelled and refunded', () => {
      expect(statusesForCustomerOrderListFilter(CustomerOrderListFilter.CANCELLED)).toEqual([
        'cancelled',
        'refunded',
      ]);
    });
  });
});
