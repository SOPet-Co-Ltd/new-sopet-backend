import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import { PromotionsResolver } from './promotions.resolver';
import { PromotionsService } from './promotions.service';
import { StoresService } from '../stores/stores.service';
import {
  MAX_VALIDATE_PROMOTIONS_TARGETS,
  ValidatePromotionsInput,
  ValidatePromotionsTargetInput,
} from './promotions.inputs';

describe('PromotionsResolver.validatePromotion', () => {
  let resolver: PromotionsResolver;
  let promotionsService: { validateCode: jest.Mock; validatePromotionsBatch: jest.Mock };
  let storesService: Record<string, never>;

  beforeEach(() => {
    promotionsService = { validateCode: jest.fn(), validatePromotionsBatch: jest.fn() };
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

describe('PromotionsResolver.validatePromotions (Decision 6)', () => {
  let resolver: PromotionsResolver;
  let promotionsService: { validateCode: jest.Mock; validatePromotionsBatch: jest.Mock };
  let storesService: Record<string, never>;
  const validationPipe = new ValidationPipe();

  beforeEach(() => {
    promotionsService = { validateCode: jest.fn(), validatePromotionsBatch: jest.fn() };
    storesService = {};
    resolver = new PromotionsResolver(
      promotionsService as unknown as PromotionsService,
      storesService as unknown as StoresService,
    );
  });

  it('is publicly callable without JWT and omits customerId (guest)', async () => {
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'p1',
          code: 'SAVE10',
          name: 'Save 10%',
          eligible: true,
          ineligibilityReason: null,
          discountAmount: 50,
          freeUnits: 0,
        },
      ],
    });

    const input: ValidatePromotionsInput = {
      promotions: [{ code: 'SAVE10' }],
      subtotal: 500,
    };

    const result = await resolver.validatePromotions(input, undefined);

    expect(promotionsService.validatePromotionsBatch).toHaveBeenCalledWith(
      [{ code: 'SAVE10' }],
      500,
      undefined,
      undefined,
      undefined,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].eligible).toBe(true);
    expect(result.items[0].discountAmount).toBe(50);
  });

  it('forwards optional JWT customerId into validatePromotionsBatch', async () => {
    const lines = [
      { productId: '11111111-1111-1111-1111-111111111111', quantity: 2, unitPrice: 100 },
    ];
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'p2',
          code: 'NEWCUST',
          name: 'New customer',
          eligible: false,
          ineligibilityReason: 'ORDER_HISTORY',
          discountAmount: 0,
          freeUnits: 0,
        },
      ],
    });

    const storeId = '22222222-2222-2222-2222-222222222222';
    const input: ValidatePromotionsInput = {
      promotions: [{ id: 'p2', code: 'NEWCUST' }],
      subtotal: 1000,
      storeId,
      lines,
    };

    const result = await resolver.validatePromotions(input, 'cust-jwt-1');

    expect(promotionsService.validatePromotionsBatch).toHaveBeenCalledWith(
      [{ id: 'p2', code: 'NEWCUST' }],
      1000,
      storeId,
      { customerId: 'cust-jwt-1' },
      lines,
    );
    expect(result.items[0].ineligibilityReason).toBe('ORDER_HISTORY');
    expect(result.items[0].eligible).toBe(false);
  });

  it('returns soft per-item outcomes without aborting the query', async () => {
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'ok',
          code: 'PCT10',
          name: '10%',
          eligible: true,
          ineligibilityReason: null,
          discountAmount: 100,
          freeUnits: 0,
        },
        {
          id: null,
          code: 'BAD',
          name: null,
          eligible: false,
          ineligibilityReason: 'INVALID_PROMOTION',
          discountAmount: 0,
          freeUnits: 0,
        },
      ],
    });

    const result = await resolver.validatePromotions(
      { promotions: [{ code: 'PCT10' }, { code: 'BAD' }], subtotal: 1000 },
      undefined,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].eligible).toBe(true);
    expect(result.items[1].eligible).toBe(false);
    expect(result.items[1].ineligibilityReason).toBe('INVALID_PROMOTION');
  });

  it('ValidationPipe rejects missing id|code as whole-query (not soft item)', async () => {
    const raw = {
      promotions: [{}],
      subtotal: 100,
    };

    await expect(
      validationPipe.transform(raw, {
        type: 'body',
        metatype: ValidatePromotionsInput,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('ValidationPipe rejects >20 promotions as whole-query', async () => {
    const promotions = Array.from({ length: MAX_VALIDATE_PROMOTIONS_TARGETS + 1 }, (_, i) => {
      const t = new ValidatePromotionsTargetInput();
      t.code = `C${i}`;
      return t;
    });
    const raw = { promotions, subtotal: 100 };

    await expect(
      validationPipe.transform(raw, {
        type: 'body',
        metatype: ValidatePromotionsInput,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('propagates service INVALID_VALIDATE_PROMOTIONS_INPUT as whole-query', async () => {
    promotionsService.validatePromotionsBatch.mockRejectedValue(
      new BadRequestException({
        code: 'INVALID_VALIDATE_PROMOTIONS_INPUT',
        message: 'promotions must contain between 1 and 20 targets',
      }),
    );

    await expect(
      resolver.validatePromotions({ promotions: [{ code: 'X' }], subtotal: 1 }, undefined),
    ).rejects.toMatchObject({ response: { code: 'INVALID_VALIDATE_PROMOTIONS_INPUT' } });
  });
});
