export type CampaignItemLike = {
  productId: string;
  variantId?: string | null;
  discountPercent?: number | null;
  compareAtPrice?: number | null;
  priority?: number;
  campaignId?: string;
  createdAt?: Date | string | null;
};

export type EffectiveUnitPrice = {
  catalogUnitPrice: number;
  unitPrice: number;
  saleCampaignId: string | null;
  saleDiscountPercent: number | null;
  compareAtPrice: number | null;
};

/** Round half-up to 2 decimal places. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Payable sale unit from catalog × (1 − %/100).
 * Returns null when percent is missing or not in 1–99, or catalog is not positive.
 */
export function computeSaleUnitPrice(
  catalogUnit: number,
  percent: number | null | undefined,
): number | null {
  if (percent == null || percent < 1 || percent > 99 || catalogUnit <= 0) {
    return null;
  }

  return roundMoney(catalogUnit * (1 - percent / 100));
}

/**
 * Strikethrough "was" for cart/checkout display.
 * Explicit campaign compare-at, else catalog when a real sale applies, else static compare-at.
 */
export function honestDisplayCompareAt(
  resolved: EffectiveUnitPrice,
  staticCompareAt?: number | null,
): number | null {
  if (resolved.compareAtPrice != null && resolved.compareAtPrice > resolved.unitPrice) {
    return resolved.compareAtPrice;
  }
  if (resolved.unitPrice < resolved.catalogUnitPrice) {
    return resolved.catalogUnitPrice;
  }
  if (staticCompareAt != null && staticCompareAt > resolved.unitPrice) {
    return staticCompareAt;
  }
  return null;
}

/** Honest was: explicit compare-at only when strictly greater than catalog. */
export function effectiveCompareAt(
  catalogUnit: number,
  campaignCompareAt: number | null | undefined,
): number | null {
  if (campaignCompareAt == null) return null;
  if (campaignCompareAt > catalogUnit) return campaignCompareAt;
  return null;
}

/**
 * Prefer product+variant match, else product with null variantId.
 * Among matches, higher priority then newer createdAt wins.
 * Callers may pass items already ordered DESC by priority/createdAt; this still
 * re-sorts so order is deterministic.
 */
export function selectWinningCampaignItem<T extends CampaignItemLike>(
  items: T[] | null | undefined,
  productId: string,
  variantId?: string | null,
): T | null {
  if (!items || items.length === 0) return null;

  const productItems = items.filter((item) => item.productId === productId);
  if (productItems.length === 0) return null;

  const ranked = [...productItems].sort((a, b) => {
    const priorityDelta = (b.priority ?? 0) - (a.priority ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  if (variantId) {
    const variantMatch = ranked.find((item) => item.variantId === variantId);
    if (variantMatch) return variantMatch;
  }

  return ranked.find((item) => item.variantId == null) ?? null;
}

export function resolveEffectiveUnitFromItem(
  catalogUnit: number,
  item: CampaignItemLike | null,
): EffectiveUnitPrice {
  const catalog = roundMoney(catalogUnit);
  if (!item) {
    return {
      catalogUnitPrice: catalog,
      unitPrice: catalog,
      saleCampaignId: null,
      saleDiscountPercent: null,
      compareAtPrice: null,
    };
  }

  const saleUnit = computeSaleUnitPrice(catalog, item.discountPercent ?? null);
  const percent =
    saleUnit != null && item.discountPercent != null ? Number(item.discountPercent) : null;

  return {
    catalogUnitPrice: catalog,
    unitPrice: saleUnit ?? catalog,
    saleCampaignId: saleUnit != null ? (item.campaignId ?? null) : null,
    saleDiscountPercent: percent,
    compareAtPrice: effectiveCompareAt(catalog, item.compareAtPrice ?? null),
  };
}
