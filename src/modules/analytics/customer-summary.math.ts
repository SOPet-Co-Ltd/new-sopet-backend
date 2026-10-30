/** Pure helpers for admin vendor/customer purchase summary metrics. */

export type CustomerCohortLabel = 'new' | 'old' | 'never';

export function computeRepeatRateLifetimeMonths(
  priorYearBuyers: number,
  returningBuyers: number,
): { repeatRate: number | null; lifetimeMonths: number | null } {
  if (priorYearBuyers <= 0) {
    return { repeatRate: null, lifetimeMonths: null };
  }

  const repeatRate = returningBuyers / priorYearBuyers;
  if (repeatRate >= 1) {
    return { repeatRate, lifetimeMonths: null };
  }

  return {
    repeatRate,
    lifetimeMonths: 12 / (1 - repeatRate),
  };
}

export function computePurchasesPerMonth(
  ordersInMonth: number,
  totalCustomers: number,
): number | null {
  if (totalCustomers <= 0) {
    return null;
  }
  return ordersInMonth / totalCustomers;
}

export function computeAverageOrderValue(revenue: number, orderCount: number): number | null {
  if (orderCount <= 0) {
    return null;
  }
  return revenue / orderCount;
}

export function computeOldCustomerShare(
  oldBuyersInMonth: number,
  buyersInMonth: number,
): { oldCustomerCount: number; oldCustomerPercent: number | null } {
  if (buyersInMonth <= 0) {
    return { oldCustomerCount: oldBuyersInMonth, oldCustomerPercent: null };
  }
  return {
    oldCustomerCount: oldBuyersInMonth,
    oldCustomerPercent: oldBuyersInMonth / buyersInMonth,
  };
}

/**
 * Whole calendar months between the first-purchase month and the as-of month
 * (inclusive of neither start nor end as a +1 — March→Oct = 7).
 * Returns 0 when both fall in the same month. Null when first purchase is after as-of.
 */
export function computeCalendarMonthLifetime(
  firstPurchaseYear: number,
  firstPurchaseMonth: number,
  asOfYear: number,
  asOfMonth: number,
): number | null {
  const firstIndex = firstPurchaseYear * 12 + (firstPurchaseMonth - 1);
  const asOfIndex = asOfYear * 12 + (asOfMonth - 1);
  if (firstIndex > asOfIndex) {
    return null;
  }
  return asOfIndex - firstIndex;
}

/**
 * Calendar months + leftover days since last purchase, relative to as-of.
 * Example: last order 15 Aug Bangkok, as-of 31 Oct Bangkok → 2 months 16 days.
 */
export function computeTimeSinceLastPurchase(
  lastPurchaseAt: Date,
  asOf: Date,
): { months: number; days: number; totalDays: number } | null {
  if (lastPurchaseAt.getTime() > asOf.getTime()) {
    return null;
  }

  const totalDays = Math.floor((asOf.getTime() - lastPurchaseAt.getTime()) / 86_400_000);
  const lastParts = bangkokYearMonthParts(lastPurchaseAt);
  const asOfParts = bangkokYearMonthParts(asOf);

  let months = (asOfParts.year - lastParts.year) * 12 + (asOfParts.month - lastParts.month);
  if (asOfParts.day < lastParts.day) {
    months -= 1;
  }
  if (months < 0) {
    months = 0;
  }

  // Normalize month overflow (e.g. month 14 → Feb next year) via Date.UTC month index.
  const anchorYear = lastParts.year + Math.floor((lastParts.month - 1 + months) / 12);
  const anchorMonth = ((lastParts.month - 1 + months) % 12) + 1;
  const anchorDay = Math.min(
    lastParts.day,
    new Date(Date.UTC(anchorYear, anchorMonth, 0)).getUTCDate(),
  );
  const anchorStart = bangkokLocalToUtc(anchorYear, anchorMonth, anchorDay, 0, 0, 0, 0);
  const asOfStart = bangkokLocalToUtc(asOfParts.year, asOfParts.month, asOfParts.day, 0, 0, 0, 0);
  const days = Math.max(0, Math.floor((asOfStart.getTime() - anchorStart.getTime()) / 86_400_000));

  return { months, days, totalDays };
}

export function resolveCustomerCohortLabel(params: {
  firstPurchaseAt: Date | null;
  monthFrom: Date;
  monthTo: Date;
}): CustomerCohortLabel {
  const { firstPurchaseAt, monthFrom, monthTo } = params;
  if (!firstPurchaseAt || firstPurchaseAt.getTime() > monthTo.getTime()) {
    return 'never';
  }
  if (firstPurchaseAt.getTime() >= monthFrom.getTime()) {
    return 'new';
  }
  return 'old';
}

export function bangkokYearMonthParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return { year, month, day };
}

/** Instant for a Bangkok wall-clock date/time (month is 1–12). */
export function bangkokLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second, ms));
}

export function bangkokMonthBounds(year: number, month: number): { from: Date; to: Date } {
  const from = bangkokLocalToUtc(year, month, 1, 0, 0, 0, 0);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = bangkokLocalToUtc(year, month, lastDay, 23, 59, 59, 999);
  return { from, to };
}

export function bangkokYearBounds(year: number, endCap?: Date): { from: Date; to: Date } {
  const from = bangkokLocalToUtc(year, 1, 1, 0, 0, 0, 0);
  let to = bangkokLocalToUtc(year, 12, 31, 23, 59, 59, 999);
  if (endCap && endCap.getTime() < to.getTime()) {
    to = endCap;
  }
  return { from, to };
}

export function assertValidSummaryMonth(year: number, month: number, now: Date = new Date()): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('INVALID_SUMMARY_YEAR');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('INVALID_SUMMARY_MONTH');
  }
  const { year: nowYear, month: nowMonth } = bangkokYearMonthParts(now);
  if (year > nowYear || (year === nowYear && month > nowMonth)) {
    throw new Error('SUMMARY_MONTH_IN_FUTURE');
  }
}

/** Reject months before the entity was created (Bangkok calendar). */
export function assertSummaryMonthNotBeforeCreatedAt(
  year: number,
  month: number,
  createdAt: Date,
): void {
  const created = bangkokYearMonthParts(createdAt);
  if (year < created.year || (year === created.year && month < created.month)) {
    throw new Error('SUMMARY_MONTH_BEFORE_CREATED');
  }
}

export function customerCohortLabelTh(label: CustomerCohortLabel): string {
  switch (label) {
    case 'new':
      return 'ลูกค้าใหม่';
    case 'old':
      return 'ลูกค้าเก่า';
    default:
      return 'ยังไม่เคยซื้อ';
  }
}
