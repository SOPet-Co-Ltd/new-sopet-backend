/**
 * Pure payout-commission math. Eligibility and paid_at cutoff stay at the
 * PayoutsService boundary — this module only sees already-split buckets.
 */

export type UnpaidBuckets = {
  unpaidPre: number;
  unpaidPost: number;
  unpaidShip: number;
};

export type PriorPayout = {
  amount: number;
  productSold: number | null;
  shippingFees: number | null;
  commissionAmount: number | null;
  commissionRate: number | null;
};

export type Breakdown = {
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
  net: number;
};

export function effectiveRate(stored: number | null, defaultRate: number): number {
  return stored ?? defaultRate;
}

/** Integer half-up of postProductSatang × ratePercent / 100 (ADR-0014 E). */
export function commissionSatang(postProductSatang: number, ratePercent: number): number {
  return Math.floor((postProductSatang * ratePercent + 50) / 100);
}

export function consumePriorPayouts(
  buckets: { preProduct: number; postProduct: number; postShipping: number },
  priorPayouts: PriorPayout[],
): UnpaidBuckets {
  let unpaidPre = toSatang(buckets.preProduct);
  let unpaidPost = toSatang(buckets.postProduct);
  let unpaidShip = toSatang(buckets.postShipping);

  for (const payout of priorPayouts) {
    if (hasSnapshot(payout)) {
      const takeProduct = toSatang(payout.productSold);
      const fromPre = Math.min(unpaidPre, takeProduct);
      unpaidPre -= fromPre;
      unpaidPost -= Math.min(unpaidPost, takeProduct - fromPre);
      unpaidShip -= Math.min(unpaidShip, toSatang(payout.shippingFees));
    } else {
      const take = toSatang(payout.amount);
      const fromPre = Math.min(unpaidPre, take);
      unpaidPre -= fromPre;
      unpaidPost -= Math.min(unpaidPost, take - fromPre);
    }
  }

  return {
    unpaidPre: fromSatang(unpaidPre),
    unpaidPost: fromSatang(unpaidPost),
    unpaidShip: fromSatang(unpaidShip),
  };
}

export function finalizeBreakdown(unpaid: UnpaidBuckets, rate: number): Breakdown {
  const unpaidPre = toSatang(unpaid.unpaidPre);
  const unpaidPost = toSatang(unpaid.unpaidPost);
  const unpaidShip = toSatang(unpaid.unpaidShip);
  const commissionAmount = commissionSatang(unpaidPost, rate);
  const productSold = unpaidPre + unpaidPost;

  return {
    productSold: fromSatang(productSold),
    shippingFees: fromSatang(unpaidShip),
    commissionAmount: fromSatang(commissionAmount),
    commissionRate: rate,
    net: fromSatang(productSold - commissionAmount + unpaidShip),
  };
}

export function consumeToAmount(unpaid: UnpaidBuckets, amount: number, rate: number): Breakdown {
  const unpaidPre = toSatang(unpaid.unpaidPre);
  const unpaidPost = toSatang(unpaid.unpaidPost);
  const unpaidShip = toSatang(unpaid.unpaidShip);
  let remaining = toSatang(amount);

  let takePre = Math.min(unpaidPre, remaining);
  remaining -= takePre;

  const maxPostNet = unpaidPost - commissionSatang(unpaidPost, rate);
  let takePost: number;
  if (remaining >= maxPostNet) {
    takePost = unpaidPost;
    remaining -= maxPostNet;
  } else {
    takePost = largestPostProduct(unpaidPost, remaining, rate);
    remaining -= takePost - commissionSatang(takePost, rate);
  }

  let takeShip = Math.min(unpaidShip, remaining);
  remaining -= takeShip;

  // Leftover satang after post rounding: absorb into 1:1 buckets, never repair commission.
  if (remaining > 0) {
    const absorbShip = Math.min(unpaidShip - takeShip, remaining);
    takeShip += absorbShip;
    remaining -= absorbShip;
  }
  if (remaining > 0) {
    const absorbPre = Math.min(unpaidPre - takePre, remaining);
    takePre += absorbPre;
  }

  const commissionAmount = commissionSatang(takePost, rate);
  const productSold = takePre + takePost;

  return {
    productSold: fromSatang(productSold),
    shippingFees: fromSatang(takeShip),
    commissionAmount: fromSatang(commissionAmount),
    commissionRate: rate,
    net: fromSatang(productSold - commissionAmount + takeShip),
  };
}

function toSatang(thb: number): number {
  return Math.floor(thb * 100 + 0.5);
}

function fromSatang(satang: number): number {
  return satang / 100;
}

function hasSnapshot(payout: PriorPayout): payout is PriorPayout & {
  productSold: number;
  shippingFees: number;
  commissionAmount: number;
  commissionRate: number;
} {
  return (
    payout.productSold !== null &&
    payout.shippingFees !== null &&
    payout.commissionAmount !== null &&
    payout.commissionRate !== null
  );
}

function largestPostProduct(unpaidPost: number, remaining: number, rate: number): number {
  let lo = 0;
  let hi = unpaidPost;
  let best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid - commissionSatang(mid, rate) <= remaining) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
