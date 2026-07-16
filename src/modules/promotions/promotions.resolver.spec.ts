import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PromotionsResolver } from './promotions.resolver';
import { PromotionsService } from './promotions.service';
import { StoresService } from '../stores/stores.service';

describe('PromotionsResolver.validatePromotion', () => {
  let resolver: PromotionsResolver;
  let promotionsService: { validateCode: jest.Mock };
  let storesService: Record<string, never>;

  beforeEach(() => {
    promotionsService = { validateCode: jest.fn() };
    storesService = {};
    resolver = new PromotionsResolver(
      promotionsService as unknown as PromotionsService,
      storesService as unknown as StoresService,
    );
  });

  it('maps soft eligibility reason and freeUnits without throwing (ADR Decision 5)', async () => {
    promotionsService.validateCode.mockResolvedValue({
      promotion: { code: 'NEWCUST', name: 'New customer' },
      discountAmount: 0,
      freeUnits: 0,
      ineligibilityReason: 'GUEST',
    });

    const result = await resolver.validatePromotion({ code: 'NEWCUST', subtotal: 500 }, undefined);

    expect(promotionsService.validateCode).toHaveBeenCalledWith(
      'NEWCUST',
      500,
      undefined,
      undefined,
      { mode: 'preview', lines: undefined },
    );
    expect(result).toEqual({
      code: 'NEWCUST',
      name: 'New customer',
      discountAmount: 0,
      ineligibilityReason: 'GUEST',
      freeUnits: 0,
    });
  });

  it('forwards lines and returns freeUnits for eligible BxGy preview', async () => {
    const lines = [
      { productId: '11111111-1111-1111-1111-111111111111', quantity: 3, unitPrice: 100 },
    ];
    promotionsService.validateCode.mockResolvedValue({
      promotion: { code: 'BXGY21', name: 'Buy 2 Get 1' },
      discountAmount: 100,
      freeUnits: 1,
      ineligibilityReason: null,
    });

    const result = await resolver.validatePromotion(
      { code: 'BXGY21', subtotal: 300, lines },
      'cust-1',
    );

    expect(promotionsService.validateCode).toHaveBeenCalledWith(
      'BXGY21',
      300,
      undefined,
      { customerId: 'cust-1' },
      { mode: 'preview', lines },
    );
    expect(result.freeUnits).toBe(1);
    expect(result.ineligibilityReason).toBeNull();
    expect(result.discountAmount).toBe(100);
  });

  it('propagates hard invalid as BadRequestException', async () => {
    promotionsService.validateCode.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_PROMOTION', message: 'Invalid promo code' }),
    );

    await expect(
      resolver.validatePromotion({ code: 'NOPE', subtotal: 100 }, undefined),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PROMOTION' } });
  });
});
