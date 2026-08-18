import { SaleCampaignPricingService } from '../../src/modules/sale-campaigns/sale-campaign-pricing.service';

export const mockSaleCampaignPricingProvider = {
  provide: SaleCampaignPricingService,
  useValue: {
    resolveEffectiveUnitPrices: jest.fn(
      async (lines: Array<{ variantId: string; catalogUnit: number }>) => {
        const map = new Map();
        for (const line of lines) {
          map.set(line.variantId, {
            catalogUnitPrice: line.catalogUnit,
            unitPrice: line.catalogUnit,
            saleCampaignId: null,
            saleDiscountPercent: null,
            compareAtPrice: null,
          });
        }
        return map;
      },
    ),
  },
};
