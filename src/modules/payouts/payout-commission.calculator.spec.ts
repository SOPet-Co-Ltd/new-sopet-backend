/**
 * Red foundation for store-commission calculator (backend-task-01 / P0-T1).
 * Green implementation is backend-task-04 — do not add payout-commission.calculator.ts here.
 *
 * Early-verification table: docs/design/store-commission-backend-design.md § Verification Strategy
 * Rounding / identity: AC-D-011, AC-D-013, ADR-0014 E
 * Cutoff / consume: AC-D-021, AC-D-022, AC-D-029
 *
 * The calculator is required at call time (not suite load) so Jest names each table row
 * when the module is missing or empty.
 */

type UnpaidBuckets = {
  unpaidPre: number;
  unpaidPost: number;
  unpaidShip: number;
};

type PriorPayout = {
  amount: number;
  productSold: number | null;
  shippingFees: number | null;
  commissionAmount: number | null;
  commissionRate: number | null;
};

type Breakdown = {
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
  net: number;
};

type CalculatorModule = {
  effectiveRate: (stored: number | null, defaultRate: number) => number;
  commissionSatang: (postProductSatang: number, ratePercent: number) => number;
  consumePriorPayouts: (
    buckets: { preProduct: number; postProduct: number; postShipping: number },
    priorPayouts: PriorPayout[],
  ) => UnpaidBuckets;
  finalizeBreakdown: (unpaid: UnpaidBuckets, rate: number) => Breakdown;
  consumeToAmount: (unpaid: UnpaidBuckets, amount: number, rate: number) => Breakdown;
  unpaidShippingForRemainingProduct: (
    orders: { product: number; shipping: number }[],
    unpaidProduct: number,
  ) => number;
};

function loadCalculator(): CalculatorModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./payout-commission.calculator') as CalculatorModule;
}

function expectBreakdown(actual: Breakdown, expected: Breakdown): void {
  expect(actual.commissionAmount).toBe(expected.commissionAmount);
  expect(actual.productSold).toBe(expected.productSold);
  expect(actual.shippingFees).toBe(expected.shippingFees);
  expect(actual.commissionRate).toBe(expected.commissionRate);
  expect(actual.net).toBe(expected.net);
}

describe('payout-commission.calculator', () => {
  describe('effectiveRate', () => {
    it.each([
      {
        name: 'AC-D-001: NULL stored rate uses default 7',
        stored: null as number | null,
        expected: 7,
      },
      {
        name: 'AC-D-006: explicit 0 is custom 0 (not default 7)',
        stored: 0,
        expected: 0,
      },
      {
        name: 'explicit custom 7 stays 7',
        stored: 7,
        expected: 7,
      },
      {
        name: 'explicit custom 5 stays 5',
        stored: 5,
        expected: 5,
      },
    ])('$name', ({ stored, expected }) => {
      const { effectiveRate } = loadCalculator();
      expect(effectiveRate(stored, 7)).toBe(expected);
    });
  });

  describe('commissionSatang', () => {
    it.each([
      {
        name: 'AC-D-011: 1000.00 THB (100000 satang) × 7% → 7000 satang (70.00)',
        postProductSatang: 100_000,
        ratePercent: 7,
        expectedSatang: 7_000,
      },
      {
        name: 'AC-D-011: 10.09 THB (1009 satang) × 7% half-up → 71 satang (0.71)',
        postProductSatang: 1_009,
        ratePercent: 7,
        expectedSatang: 71,
      },
    ])('$name', ({ postProductSatang, ratePercent, expectedSatang }) => {
      const { commissionSatang } = loadCalculator();
      expect(commissionSatang(postProductSatang, ratePercent)).toBe(expectedSatang);
    });
  });

  describe('finalizeBreakdown', () => {
    it.each([
      {
        name: 'AC-D-011 / AC-D-013: post-cutoff product 1000.00, shipping 80.00, rate 7 → commissionAmount === 70.00, net 1010.00',
        unpaid: { unpaidPre: 0, unpaidPost: 1000, unpaidShip: 80 } satisfies UnpaidBuckets,
        rate: 7,
        expected: {
          productSold: 1000,
          shippingFees: 80,
          commissionAmount: 70,
          commissionRate: 7,
          net: 1010,
        } satisfies Breakdown,
      },
      {
        name: 'AC-D-011 / AC-D-013: 10.09 × 7% half-up → commissionAmount === 0.71, net 9.38 derived (no IEEE drift, no commissionAmount repair)',
        unpaid: { unpaidPre: 0, unpaidPost: 10.09, unpaidShip: 0 } satisfies UnpaidBuckets,
        rate: 7,
        expected: {
          productSold: 10.09,
          shippingFees: 0,
          commissionAmount: 0.71,
          commissionRate: 7,
          net: 9.38,
        } satisfies Breakdown,
      },
      {
        name: 'AC-D-021 / AC-D-022: NULL paid_at is pre-cutoff (0 commission, 0 shipping)',
        unpaid: { unpaidPre: 1000, unpaidPost: 0, unpaidShip: 0 } satisfies UnpaidBuckets,
        rate: 7,
        expected: {
          productSold: 1000,
          shippingFees: 0,
          commissionAmount: 0,
          commissionRate: 7,
          net: 1000,
        } satisfies Breakdown,
      },
    ])('$name', ({ unpaid, rate, expected }) => {
      const { finalizeBreakdown } = loadCalculator();
      expectBreakdown(finalizeBreakdown(unpaid, rate), expected);
    });
  });

  describe('consumePriorPayouts', () => {
    it('AC-D-022: historical amount=1000 consume pre first (shipping unchanged)', () => {
      const { consumePriorPayouts, finalizeBreakdown } = loadCalculator();
      const unpaid = consumePriorPayouts(
        { preProduct: 1500, postProduct: 1000, postShipping: 80 },
        [
          {
            amount: 1000,
            productSold: null,
            shippingFees: null,
            commissionAmount: null,
            commissionRate: null,
          } satisfies PriorPayout,
        ],
      );

      expect(unpaid).toEqual({
        unpaidPre: 500,
        unpaidPost: 1000,
        unpaidShip: 80,
      });

      expectBreakdown(finalizeBreakdown(unpaid, 7), {
        productSold: 1500,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        net: 1510,
      });
    });

    it('AC-D-023: large-unpaid mixed-cutoff (pre + post + shipping + prior snapshot + historical NULL-snapshot)', () => {
      const { consumePriorPayouts, finalizeBreakdown } = loadCalculator();
      const unpaid = consumePriorPayouts(
        { preProduct: 2000, postProduct: 1000, postShipping: 80 },
        [
          {
            amount: 1000,
            productSold: null,
            shippingFees: null,
            commissionAmount: null,
            commissionRate: null,
          } satisfies PriorPayout,
          {
            amount: 500,
            productSold: 500,
            shippingFees: 0,
            commissionAmount: 0,
            commissionRate: 7,
          } satisfies PriorPayout,
        ],
      );

      expect(unpaid).toEqual({
        unpaidPre: 500,
        unpaidPost: 1000,
        unpaidShip: 80,
      });

      expectBreakdown(finalizeBreakdown(unpaid, 7), {
        productSold: 1500,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        net: 1510,
      });
    });
  });

  describe('unpaidShippingForRemainingProduct', () => {
    it('keeps shipping only on the remaining unpaid order (3 × ฿50 with ฿220 left → ฿50)', () => {
      const { unpaidShippingForRemainingProduct } = loadCalculator();
      expect(
        unpaidShippingForRemainingProduct(
          [
            { product: 250, shipping: 50 },
            { product: 220, shipping: 50 },
            { product: 220, shipping: 50 },
          ],
          220,
        ),
      ).toBe(50);
    });

    it('returns 0 shipping when unpaid product is 0 (11 × ฿50 omise leftover)', () => {
      const { unpaidShippingForRemainingProduct } = loadCalculator();
      expect(
        unpaidShippingForRemainingProduct(
          Array.from({ length: 11 }, () => ({ product: 200, shipping: 50 })),
          0,
        ),
      ).toBe(0);
    });
  });

  describe('consumeToAmount', () => {
    const unpaidNet600: UnpaidBuckets = {
      unpaidPre: 100,
      unpaidPost: 500,
      unpaidShip: 35,
    };

    it.each([
      {
        name: 'AC-D-029: consume-to-amount A=200 < unpaid net 600 (pre first, then post; shipping last / untouched)',
        amount: 200,
        expected: {
          productSold: 207.53,
          shippingFees: 0,
          commissionAmount: 7.53,
          commissionRate: 7,
          net: 200,
        } satisfies Breakdown,
      },
      {
        name: 'AC-D-029: consume-to-amount A=580 < unpaid net 600 reaches shipping last (pre then post then shipping)',
        amount: 580,
        expected: {
          productSold: 600,
          shippingFees: 15,
          commissionAmount: 35,
          commissionRate: 7,
          net: 580,
        } satisfies Breakdown,
      },
    ])('$name', ({ amount, expected }) => {
      const { consumeToAmount } = loadCalculator();
      expectBreakdown(consumeToAmount(unpaidNet600, amount, 7), expected);
    });
  });
});
