import { BadRequestException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionScope, PromotionType } from '../../database/entities/promotion.entity';

describe('PromotionsService', () => {
  const mockPromotion = {
    id: 'promo-1',
    code: 'WELCOME10',
    name: 'Welcome 10%',
    type: PromotionType.PERCENTAGE,
    scope: PromotionScope.PLATFORM,
    discountValue: 10,
    minPurchaseAmount: null,
    maxDiscountAmount: null,
    usageLimit: null,
    usageCount: 0,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    storeId: null,
    deletedAt: null,
  };

  let service: PromotionsService;
  let promotionRepository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };

  beforeEach(() => {
    promotionRepository = {
      findOne: jest.fn().mockResolvedValue(mockPromotion),
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn(),
    };
    service = new PromotionsService(promotionRepository as never);
  });

  it('validates a percentage promotion', async () => {
    const result = await service.validateCode('WELCOME10', 1000);
    expect(result.discountAmount).toBe(100);
    expect(result.promotion.code).toBe('WELCOME10');
  });

  it('throws for invalid promotion code', async () => {
    promotionRepository.findOne.mockResolvedValue(null);
    await expect(service.validateCode('INVALID', 100)).rejects.toThrow(BadRequestException);
  });

  it('stacks platform and store promotions', async () => {
    const storePromo = {
      ...mockPromotion,
      id: 'promo-2',
      code: 'STORE5',
      scope: PromotionScope.STORE,
      storeId: 'store-1',
      discountValue: 5,
    };

    promotionRepository.findOne
      .mockResolvedValueOnce(mockPromotion)
      .mockResolvedValueOnce(storePromo)
      .mockResolvedValueOnce(storePromo);

    const storeSubtotals = new Map([['store-1', 500]]);
    const result = await service.applyStackedPromotions(1000, storeSubtotals, 'WELCOME10', [
      'STORE5',
    ]);

    expect(result.promotions).toHaveLength(2);
    expect(result.discountAmount).toBeGreaterThan(0);
  });

  it('rejects expired promotion', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      expiresAt: new Date('2020-01-01'),
    });

    await expect(service.validateCode('WELCOME10', 100)).rejects.toMatchObject({
      response: { code: 'PROMOTION_EXPIRED' },
    });
  });

  it('rejects promotion below min purchase', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      minPurchaseAmount: 500,
    });

    await expect(service.validateCode('WELCOME10', 100)).rejects.toMatchObject({
      response: { code: 'PROMOTION_MIN_PURCHASE' },
    });
  });

  it('calculates fixed amount discount', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      type: PromotionType.FIXED_AMOUNT,
      discountValue: 50,
    });

    const result = await service.validateCode('FIXED50', 1000);
    expect(result.discountAmount).toBe(50);
  });

  it('caps discount at maxDiscountAmount', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      maxDiscountAmount: 50,
    });

    const result = await service.validateCode('WELCOME10', 10000);
    expect(result.discountAmount).toBe(50);
  });

  it('finds active platform promotions', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([mockPromotion]),
    };
    promotionRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

    const result = await service.findActive();
    expect(result).toHaveLength(1);
  });

  it('creates a platform promotion', async () => {
    const created = { ...mockPromotion, code: 'NEW10' };
    promotionRepository.create = jest.fn().mockReturnValue(created);
    promotionRepository.save = jest.fn().mockResolvedValue(created);

    const result = await service.create(
      {
        code: 'new10',
        name: 'New 10%',
        type: PromotionType.PERCENTAGE,
        discountValue: 10,
      },
      PromotionScope.PLATFORM,
    );

    expect(result.code).toBe('NEW10');
    expect(promotionRepository.save).toHaveBeenCalled();
  });

  it('soft deletes a promotion', async () => {
    promotionRepository.findOne = jest.fn().mockResolvedValue(mockPromotion);
    promotionRepository.softRemove = jest.fn().mockResolvedValue(undefined);

    await service.softDelete('promo-1');
    expect(promotionRepository.softRemove).toHaveBeenCalled();
  });
});
