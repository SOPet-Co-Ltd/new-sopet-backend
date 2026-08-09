import { SaleCampaignPricingService } from './sale-campaign-pricing.service';

describe('SaleCampaignPricingService', () => {
  const itemRepository = {
    createQueryBuilder: jest.fn(),
  };

  let service: SaleCampaignPricingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SaleCampaignPricingService(itemRepository as never);
  });

  describe('findActiveItemsForProducts', () => {
    it('returns empty when productIds is empty', async () => {
      await expect(service.findActiveItemsForProducts([])).resolves.toEqual([]);
      expect(itemRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('resolveEffectiveUnitPrices', () => {
    it('returns catalog when there are no product ids', async () => {
      const result = await service.resolveEffectiveUnitPrices([]);
      expect(result.size).toBe(0);
    });

    it('applies winning campaign percent to catalog unit', async () => {
      itemRepository.createQueryBuilder.mockReturnValue({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            productId: 'prod-1',
            variantId: null,
            discountPercent: 20,
            compareAtPrice: null,
            campaign: {
              id: 'camp-1',
              priority: 10,
              createdAt: new Date('2026-08-01T00:00:00.000Z'),
            },
          },
        ]),
      });

      const result = await service.resolveEffectiveUnitPrices([
        { productId: 'prod-1', variantId: 'var-1', catalogUnit: 279 },
      ]);

      expect(result.get('var-1')).toEqual({
        catalogUnitPrice: 279,
        unitPrice: 223.2,
        saleCampaignId: 'camp-1',
        saleDiscountPercent: 20,
        compareAtPrice: null,
      });
    });
  });
});
