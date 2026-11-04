import {
  assertSummaryMonthNotBeforeCreatedAt,
  assertValidSummaryMonth,
  bangkokLocalToUtc,
  bangkokMonthBounds,
  bangkokYearMonthParts,
  computeAverageOrderValue,
  computeCalendarMonthLifetime,
  computeOldCustomerShare,
  computePurchasesPerMonth,
  computeRepeatRateLifetimeMonths,
  computeTimeSinceLastPurchase,
  resolveCustomerCohortLabel,
} from './customer-summary.math';

describe('customer-summary.math', () => {
  describe('computeRepeatRateLifetimeMonths', () => {
    it('matches 80/200 → 40% → 20 months', () => {
      expect(computeRepeatRateLifetimeMonths(200, 80)).toEqual({
        repeatRate: 0.4,
        lifetimeMonths: 20,
      });
    });

    it('returns null lifetime when there are no prior-year buyers', () => {
      expect(computeRepeatRateLifetimeMonths(0, 0)).toEqual({
        repeatRate: null,
        lifetimeMonths: null,
      });
    });

    it('returns null lifetime when repeat rate is 100%', () => {
      expect(computeRepeatRateLifetimeMonths(50, 50)).toEqual({
        repeatRate: 1,
        lifetimeMonths: null,
      });
    });
  });

  describe('computePurchasesPerMonth', () => {
    it('matches 36/200 → 0.18', () => {
      expect(computePurchasesPerMonth(36, 200)).toBeCloseTo(0.18);
    });

    it('returns null when there are no customers', () => {
      expect(computePurchasesPerMonth(10, 0)).toBeNull();
    });
  });

  describe('computeAverageOrderValue', () => {
    it('matches 25200/36 → 700', () => {
      expect(computeAverageOrderValue(25200, 36)).toBe(700);
    });

    it('returns null when there are no orders', () => {
      expect(computeAverageOrderValue(0, 0)).toBeNull();
    });
  });

  describe('computeOldCustomerShare', () => {
    it('matches 30/100 → 30%', () => {
      expect(computeOldCustomerShare(30, 100)).toEqual({
        oldCustomerCount: 30,
        oldCustomerPercent: 0.3,
      });
    });

    it('returns null percent when nobody bought in the month', () => {
      expect(computeOldCustomerShare(0, 0)).toEqual({
        oldCustomerCount: 0,
        oldCustomerPercent: null,
      });
    });
  });

  describe('computeCalendarMonthLifetime', () => {
    it('returns 0 when first purchase is in the as-of month', () => {
      expect(computeCalendarMonthLifetime(2026, 3, 2026, 3)).toBe(0);
    });

    it('counts whole months between first purchase and as-of', () => {
      expect(computeCalendarMonthLifetime(2025, 3, 2025, 10)).toBe(7);
    });

    it('returns null when first purchase is after as-of', () => {
      expect(computeCalendarMonthLifetime(2026, 5, 2026, 3)).toBeNull();
    });
  });

  describe('computeTimeSinceLastPurchase', () => {
    it('returns months and leftover days since last order', () => {
      const last = bangkokLocalToUtc(2026, 8, 15, 12, 0, 0, 0);
      const asOf = bangkokLocalToUtc(2026, 10, 31, 12, 0, 0, 0);
      expect(computeTimeSinceLastPurchase(last, asOf)).toEqual({
        months: 2,
        days: 16,
        totalDays: 77,
      });
    });

    it('returns 0 months and days when last order is the same Bangkok day', () => {
      const last = bangkokLocalToUtc(2026, 10, 31, 9, 0, 0, 0);
      const asOf = bangkokLocalToUtc(2026, 10, 31, 18, 0, 0, 0);
      expect(computeTimeSinceLastPurchase(last, asOf)).toMatchObject({
        months: 0,
        days: 0,
      });
    });

    it('returns null when last order is after as-of', () => {
      const last = bangkokLocalToUtc(2026, 11, 1, 0, 0, 0, 0);
      const asOf = bangkokLocalToUtc(2026, 10, 31, 0, 0, 0, 0);
      expect(computeTimeSinceLastPurchase(last, asOf)).toBeNull();
    });
  });

  describe('resolveCustomerCohortLabel', () => {
    const { from, to } = bangkokMonthBounds(2026, 3);

    it('labels first purchase in month as new', () => {
      expect(
        resolveCustomerCohortLabel({
          firstPurchaseAt: bangkokMonthBounds(2026, 3).from,
          monthFrom: from,
          monthTo: to,
        }),
      ).toBe('new');
    });

    it('labels earlier first purchase as old', () => {
      expect(
        resolveCustomerCohortLabel({
          firstPurchaseAt: bangkokMonthBounds(2025, 12).from,
          monthFrom: from,
          monthTo: to,
        }),
      ).toBe('old');
    });

    it('labels missing first purchase as never', () => {
      expect(
        resolveCustomerCohortLabel({
          firstPurchaseAt: null,
          monthFrom: from,
          monthTo: to,
        }),
      ).toBe('never');
    });
  });

  describe('bangkokMonthBounds', () => {
    it('starts at Bangkok midnight on day 1', () => {
      const { from } = bangkokMonthBounds(2026, 3);
      expect(bangkokYearMonthParts(from)).toEqual({ year: 2026, month: 3, day: 1 });
      expect(from.toISOString()).toBe('2026-02-28T17:00:00.000Z');
    });
  });

  describe('assertValidSummaryMonth', () => {
    it('rejects future months', () => {
      const now = bangkokMonthBounds(2026, 3).from;
      expect(() => assertValidSummaryMonth(2026, 4, now)).toThrow('SUMMARY_MONTH_IN_FUTURE');
    });

    it('accepts the current month', () => {
      const now = bangkokMonthBounds(2026, 3).from;
      expect(() => assertValidSummaryMonth(2026, 3, now)).not.toThrow();
    });
  });

  describe('assertSummaryMonthNotBeforeCreatedAt', () => {
    it('rejects months before creation', () => {
      expect(() =>
        assertSummaryMonthNotBeforeCreatedAt(2026, 6, bangkokLocalToUtc(2026, 7, 1)),
      ).toThrow('SUMMARY_MONTH_BEFORE_CREATED');
    });

    it('accepts the creation month', () => {
      expect(() =>
        assertSummaryMonthNotBeforeCreatedAt(2026, 7, bangkokLocalToUtc(2026, 7, 15)),
      ).not.toThrow();
    });
  });
});
