import {
  computeSaleUnitPrice,
  effectiveCompareAt,
  honestDisplayCompareAt,
  resolveEffectiveUnitFromItem,
  roundMoney,
  selectWinningCampaignItem,
} from './sale-campaign-pricing';

describe('roundMoney', () => {
  it('rounds half-up to 2 decimals', () => {
    expect(roundMoney(223.2)).toBe(223.2);
    expect(roundMoney(223.205)).toBe(223.21);
    expect(roundMoney(10.004)).toBe(10);
  });
});

describe('computeSaleUnitPrice', () => {
  it('applies 20% off catalog 279 → 223.20', () => {
    expect(computeSaleUnitPrice(279, 20)).toBe(223.2);
  });

  it('applies 10% off catalog 90 → 81', () => {
    expect(computeSaleUnitPrice(90, 10)).toBe(81);
  });

  it('returns null when percent is missing or out of 1–99', () => {
    expect(computeSaleUnitPrice(100, null)).toBeNull();
    expect(computeSaleUnitPrice(100, 0)).toBeNull();
    expect(computeSaleUnitPrice(100, 100)).toBeNull();
    expect(computeSaleUnitPrice(0, 20)).toBeNull();
  });
});

describe('honestDisplayCompareAt', () => {
  it('uses explicit campaign compare-at when greater than sale unit', () => {
    expect(
      honestDisplayCompareAt({
        catalogUnitPrice: 279,
        unitPrice: 223.2,
        saleCampaignId: 'c1',
        saleDiscountPercent: 20,
        compareAtPrice: 349,
      }),
    ).toBe(349);
  });

  it('uses catalog as was when % sale applies without compare-at', () => {
    expect(
      honestDisplayCompareAt({
        catalogUnitPrice: 279,
        unitPrice: 223.2,
        saleCampaignId: 'c1',
        saleDiscountPercent: 20,
        compareAtPrice: null,
      }),
    ).toBe(279);
  });

  it('falls back to static compare-at when there is no sale', () => {
    expect(
      honestDisplayCompareAt(
        {
          catalogUnitPrice: 279,
          unitPrice: 279,
          saleCampaignId: null,
          saleDiscountPercent: null,
          compareAtPrice: null,
        },
        349,
      ),
    ).toBe(349);
  });

  it('returns null when nothing is higher than the payable unit', () => {
    expect(
      honestDisplayCompareAt(
        {
          catalogUnitPrice: 279,
          unitPrice: 279,
          saleCampaignId: null,
          saleDiscountPercent: null,
          compareAtPrice: null,
        },
        200,
      ),
    ).toBeNull();
  });
});

describe('effectiveCompareAt', () => {
  it('returns compare-at only when greater than catalog', () => {
    expect(effectiveCompareAt(279, 349)).toBe(349);
    expect(effectiveCompareAt(279, 279)).toBeNull();
    expect(effectiveCompareAt(279, 200)).toBeNull();
    expect(effectiveCompareAt(279, null)).toBeNull();
  });
});

describe('selectWinningCampaignItem', () => {
  it('prefers variant-specific item over product-level', () => {
    const allVariants = { productId: 'p1', variantId: null, priority: 10, campaignId: 'a' };
    const exact = { productId: 'p1', variantId: 'v1', priority: 1, campaignId: 'b' };
    expect(selectWinningCampaignItem([allVariants, exact], 'p1', 'v1')).toEqual(exact);
  });

  it('picks higher priority then newer createdAt', () => {
    const older = {
      productId: 'p1',
      variantId: null,
      priority: 5,
      campaignId: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
      productId: 'p1',
      variantId: null,
      priority: 5,
      campaignId: 'new',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    expect(selectWinningCampaignItem([older, newer], 'p1', 'v1')?.campaignId).toBe('new');
  });
});

describe('resolveEffectiveUnitFromItem', () => {
  it('returns catalog when there is no item or no usable %', () => {
    expect(resolveEffectiveUnitFromItem(279, null).unitPrice).toBe(279);
    expect(
      resolveEffectiveUnitFromItem(279, {
        productId: 'p1',
        discountPercent: null,
        campaignId: 'c1',
      }).unitPrice,
    ).toBe(279);
  });

  it('applies sale unit and snapshots campaign when % is valid', () => {
    const resolved = resolveEffectiveUnitFromItem(279, {
      productId: 'p1',
      discountPercent: 20,
      compareAtPrice: 349,
      campaignId: 'camp-1',
    });
    expect(resolved).toEqual({
      catalogUnitPrice: 279,
      unitPrice: 223.2,
      saleCampaignId: 'camp-1',
      saleDiscountPercent: 20,
      compareAtPrice: 349,
    });
  });
});
