import { BadRequestException } from '@nestjs/common';
import { PromotionsService, PromotionCustomerIdentity } from './promotions.service';
import { PromotionScope, PromotionType } from '../../database/entities/promotion.entity';

/** Future validateCode options (Design Doc Interface Change Matrix) — not on service yet. */
type ValidateCodeOptions = {
  lines?: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    storeId?: string;
  }>;
  mode?: 'preview' | 'apply';
};

type ValidateCodeResult = {
  promotion: { code: string; conditions?: Record<string, unknown> };
  discountAmount: number;
  freeUnits?: number;
  ineligibilityReason?: string | null;
};

/**
 * Red-scaffold call site for planned validateCode(…, options).
 * 5th arg is ignored until later tasks implement mode/lines/eligibility fields.
 */
async function validateCodeExtended(
  service: PromotionsService,
  code: string,
  subtotal: number,
  storeId: string | undefined,
  customer: PromotionCustomerIdentity | undefined,
  options: ValidateCodeOptions,
): Promise<ValidateCodeResult> {
  return (
    service.validateCode as (
      code: string,
      subtotal: number,
      storeId?: string,
      customer?: PromotionCustomerIdentity,
      options?: ValidateCodeOptions,
    ) => Promise<ValidateCodeResult>
  )(code, subtotal, storeId, customer, options);
}

type ApplyStackedResult = {
  promotions: unknown[];
  discountAmount: number;
  freeUnits?: number;
};

/**
 * Red-scaffold call site for planned applyStackedPromotions(…, options with lines).
 * Extra options arg ignored until stacking forwards lines / freeUnits (AC-035).
 */
async function applyStackedExtended(
  service: PromotionsService,
  subtotal: number,
  storeSubtotals: Map<string, number>,
  platformCode: string | undefined,
  storeCodes: string[] | undefined,
  customer: PromotionCustomerIdentity | undefined,
  options: ValidateCodeOptions,
): Promise<ApplyStackedResult> {
  return (
    service.applyStackedPromotions as (
      subtotal: number,
      storeSubtotals: Map<string, number>,
      platformCode?: string,
      storeCodes?: string[],
      customer?: PromotionCustomerIdentity,
      options?: ValidateCodeOptions,
    ) => Promise<ApplyStackedResult>
  )(subtotal, storeSubtotals, platformCode, storeCodes, customer, options);
}

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
    usagePerCustomer: 1,
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
  let promotionUsageRepository: {
    createQueryBuilder: jest.Mock;
  };
  let usageQueryBuilder: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };

  beforeEach(() => {
    usageQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    promotionUsageRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(usageQueryBuilder),
    };
    promotionRepository = {
      findOne: jest.fn().mockResolvedValue(mockPromotion),
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      softRemove: jest.fn(),
    };
    service = new PromotionsService(
      promotionRepository as never,
      promotionUsageRepository as never,
    );
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

  it('rejects promotion when total usage limit is reached', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      usageLimit: 10,
      usageCount: 10,
    });

    await expect(service.validateCode('WELCOME10', 100)).rejects.toMatchObject({
      response: { code: 'PROMOTION_LIMIT' },
    });
  });

  it('rejects promotion when customer usage limit is reached', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      usagePerCustomer: 1,
    });
    usageQueryBuilder.getCount.mockResolvedValue(1);

    await expect(
      service.validateCode('WELCOME10', 100, undefined, { customerId: 'cust-1' }),
    ).rejects.toMatchObject({
      response: { code: 'PROMOTION_CUSTOMER_LIMIT' },
    });
  });

  it('rejects promotion when guest phone usage limit is reached', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      usagePerCustomer: 2,
    });
    usageQueryBuilder.getCount.mockResolvedValue(2);

    await expect(
      service.validateCode('WELCOME10', 100, undefined, { guestPhone: '+66812345678' }),
    ).rejects.toMatchObject({
      response: { code: 'PROMOTION_CUSTOMER_LIMIT' },
    });
  });

  it('allows unlimited per-customer usage when usagePerCustomer is 0', async () => {
    promotionRepository.findOne.mockResolvedValue({
      ...mockPromotion,
      usagePerCustomer: 0,
    });
    usageQueryBuilder.getCount.mockResolvedValue(5);

    const result = await service.validateCode('WELCOME10', 1000, undefined, {
      customerId: 'cust-1',
    });

    expect(result.discountAmount).toBe(100);
    expect(promotionUsageRepository.createQueryBuilder).not.toHaveBeenCalled();
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

  // -------------------------------------------------------------------------
  // Phase 0 Red scaffolds — integration case 1–3 proof obligations
  // Expected: FAIL until backend-task-02..07 (gates / BxGy / write / agreement).
  // Failures must be assertion mismatches, not compile/import errors.
  // -------------------------------------------------------------------------

  describe('case-1: new-customer dual gates (AC-003–012)', () => {
    const conditionedPromo = {
      ...mockPromotion,
      id: 'promo-newcust',
      code: 'NEWCUST10',
      type: PromotionType.PERCENTAGE,
      discountValue: 10,
      conditions: { newCustomer: { enabled: true, nDays: 7 } },
    };

    beforeEach(() => {
      promotionRepository.findOne.mockResolvedValue(conditionedPromo);
    });

    it('preview guest: discountAmount=0, ineligibilityReason=GUEST (AC-003)', async () => {
      const result = await validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(0);
      expect(result.freeUnits ?? 0).toBe(0);
      expect(result.ineligibilityReason).toBe('GUEST');
    });

    it('apply guest: hard-throws GUEST (AC-003 create path)', async () => {
      await expect(
        validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, {
          mode: 'apply',
        }),
      ).rejects.toMatchObject({ response: { code: 'GUEST' } });
    });

    it('preview ORDER_HISTORY: soft reason, discountAmount=0 (AC-006)', async () => {
      // Gate wiring (Customer/Order repos) lands in later tasks; assert soft contract now.
      const result = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('ORDER_HISTORY');
    });

    it('apply ORDER_HISTORY: hard-throws matching code (AC-006)', async () => {
      await expect(
        validateCodeExtended(
          service,
          'NEWCUST10',
          1000,
          undefined,
          { customerId: 'cust-paid' },
          { mode: 'apply' },
        ),
      ).rejects.toMatchObject({ response: { code: 'ORDER_HISTORY' } });
    });

    it('non-paid-path-only history does not set ORDER_HISTORY (AC-007 proof C)', async () => {
      // cancelled/pending-only orders → history gate still passes (not ORDER_HISTORY).
      const result = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-non-paid-only' },
        { mode: 'preview' },
      );

      expect(result.ineligibilityReason).not.toBe('ORDER_HISTORY');
      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason == null || result.ineligibilityReason === null).toBe(true);
    });

    it('preview ACCOUNT_AGE: soft reason when past nDays×24h window (AC-010)', async () => {
      const result = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-old' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('ACCOUNT_AGE');
    });

    it('apply ACCOUNT_AGE: hard-throws ACCOUNT_AGE (AC-010)', async () => {
      await expect(
        validateCodeExtended(
          service,
          'NEWCUST10',
          1000,
          undefined,
          { customerId: 'cust-old' },
          { mode: 'apply' },
        ),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_AGE' } });
    });

    it('either-gate failure never yields positive discountAmount (AC-011 AND)', async () => {
      const historyFail = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'preview' },
      );
      const ageFail = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-old' },
        { mode: 'preview' },
      );

      expect(historyFail.discountAmount).toBe(0);
      expect(ageFail.discountAmount).toBe(0);
      expect(historyFail.discountAmount).not.toBeGreaterThan(0);
      expect(ageFail.discountAmount).not.toBeGreaterThan(0);
    });

    it('both gates pass → discount applies for conditioned percentage (AC-005/009/012)', async () => {
      const result = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-eligible' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason == null || result.ineligibilityReason === null).toBe(true);
    });
  });

  describe('case-2: BxGy Rules A/B + MISSING_LINES vs INSUFFICIENT_QTY (AC-019–022, AC-037–038)', () => {
    const bxgyPromo = {
      ...mockPromotion,
      id: 'promo-bxgy',
      code: 'BXGY21',
      type: PromotionType.BUY_X_GET_Y,
      discountValue: 0,
      conditions: {
        productId: 'product-p',
        buyQuantity: 2,
        getQuantity: 1,
      },
    };

    const linesForQ = (
      quantitiesAndPrices: Array<{ quantity: number; unitPrice: number; variantId?: string }>,
    ) =>
      quantitiesAndPrices.map((row, index) => ({
        productId: 'product-p',
        variantId: row.variantId ?? `var-${index}`,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
      }));

    beforeEach(() => {
      promotionRepository.findOne.mockResolvedValue(bxgyPromo);
    });

    it.each([
      { Q: 2, freeUnits: 0 },
      { Q: 3, freeUnits: 1 },
      { Q: 5, freeUnits: 1 },
      { Q: 6, freeUnits: 2 },
    ])(
      'Rule A: Buy 2 Get 1 freeUnits for Q=$Q equals $freeUnits (AC-019)',
      async ({ Q, freeUnits }) => {
        const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'preview',
          lines: linesForQ([{ quantity: Q, unitPrice: 100 }]),
        });

        expect(result.freeUnits).toBe(freeUnits);
      },
    );

    it('Rule B: discountAmount equals sum of cheapest freeUnits unit prices (AC-020–022)', async () => {
      // Q=6 → freeUnits=2; unit prices 50, 80, 120 → cheapest two = 50+80 = 130
      const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'preview',
        lines: [
          { productId: 'product-p', variantId: 'a', quantity: 2, unitPrice: 50 },
          { productId: 'product-p', variantId: 'b', quantity: 2, unitPrice: 80 },
          { productId: 'product-p', variantId: 'c', quantity: 2, unitPrice: 120 },
          { productId: 'foreign', variantId: 'x', quantity: 10, unitPrice: 1 },
        ],
      });

      expect(result.freeUnits).toBe(2);
      expect(result.discountAmount).toBe(130);
    });

    it('preview missing lines: MISSING_LINES, freeUnits=0 (AC-037a)', async () => {
      const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(0);
      expect(result.freeUnits ?? 0).toBe(0);
      expect(result.ineligibilityReason).toBe('MISSING_LINES');
    });

    it('apply missing lines: hard-throws MISSING_LINES (AC-037a)', async () => {
      await expect(
        validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'apply',
        }),
      ).rejects.toMatchObject({ response: { code: 'MISSING_LINES' } });
    });

    it('preview freeUnits=0 with lines: INSUFFICIENT_QTY soft (AC-037b)', async () => {
      const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'preview',
        lines: linesForQ([{ quantity: 2, unitPrice: 100 }]),
      });

      expect(result.discountAmount).toBe(0);
      expect(result.freeUnits ?? 0).toBe(0);
      expect(result.ineligibilityReason).toBe('INSUFFICIENT_QTY');
    });

    it('apply freeUnits=0 with lines: skip without throw (AC-037b/c)', async () => {
      await expect(
        validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'apply',
          lines: linesForQ([{ quantity: 2, unitPrice: 100 }]),
        }),
      ).resolves.toMatchObject({ discountAmount: 0 });
    });
  });

  describe('case-3: Rule C clamp + conditions write + preview/apply agreement (AC-015/016/036, AC-023/024, AC-035)', () => {
    it('Rule C: FIXED_AMOUNT V=100 B=60 → discountAmount=60 (AC-015/036)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...mockPromotion,
        type: PromotionType.FIXED_AMOUNT,
        discountValue: 100,
      });

      const result = await service.validateCode('FIXED100', 60);
      expect(result.discountAmount).toBe(60);
    });

    it('Rule C: FIXED_AMOUNT V=40 B=60 → discountAmount=40 (AC-016)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...mockPromotion,
        type: PromotionType.FIXED_AMOUNT,
        discountValue: 40,
      });

      const result = await service.validateCode('FIXED40', 60);
      expect(result.discountAmount).toBe(40);
    });

    it('write rejects BUY_X_GET_Y without productId (AC-023)', async () => {
      await expect(
        service.create(
          {
            code: 'bxgy-bad',
            name: 'BxGy missing product',
            type: PromotionType.BUY_X_GET_Y,
            discountValue: 0,
            conditions: JSON.stringify({ buyQuantity: 2, getQuantity: 1 }),
          },
          PromotionScope.PLATFORM,
        ),
      ).rejects.toMatchObject({ response: { code: 'INVALID_BXGY_CONDITIONS' } });
    });

    it('write persists productId, buyQuantity, getQuantity for valid BxGy (AC-024)', async () => {
      const conditions = {
        productId: 'product-p',
        buyQuantity: 2,
        getQuantity: 1,
      };
      const created = {
        ...mockPromotion,
        id: 'promo-bxgy-ok',
        code: 'BXGYOK',
        type: PromotionType.BUY_X_GET_Y,
        conditions,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'bxgyok',
          name: 'BxGy ok',
          type: PromotionType.BUY_X_GET_Y,
          discountValue: 0,
          conditions: JSON.stringify(conditions),
        },
        PromotionScope.PLATFORM,
      );

      expect(result.conditions).toMatchObject({
        productId: 'product-p',
        buyQuantity: 2,
        getQuantity: 1,
      });
      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions,
        }),
      );
    });

    it('write rejects newCustomer.enabled without positive nDays (AC-008)', async () => {
      await expect(
        service.create(
          {
            code: 'newcust-bad',
            name: 'New customer bad',
            type: PromotionType.PERCENTAGE,
            discountValue: 10,
            conditions: JSON.stringify({ newCustomer: { enabled: true, nDays: 0 } }),
          },
          PromotionScope.PLATFORM,
        ),
      ).rejects.toMatchObject({ response: { code: 'INVALID_NEW_CUSTOMER_CONDITIONS' } });
    });

    it('write persists newCustomer.enabled + positive nDays camelCase (AC-001/AC-008)', async () => {
      const conditions = { newCustomer: { enabled: true, nDays: 14 } };
      const created = {
        ...mockPromotion,
        id: 'promo-newcust-ok',
        code: 'NEWCUSTOK',
        type: PromotionType.PERCENTAGE,
        discountValue: 10,
        conditions,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'newcustok',
          name: 'New customer ok',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          conditions: JSON.stringify(conditions),
        },
        PromotionScope.PLATFORM,
      );

      expect(result.conditions).toMatchObject({
        newCustomer: { enabled: true, nDays: 14 },
      });
      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          conditions,
        }),
      );
    });

    it('eligible validateCode(preview) and applyStackedPromotions agree on discountAmount and freeUnits (AC-035)', async () => {
      const bxgyPromo = {
        ...mockPromotion,
        id: 'promo-agree',
        code: 'AGREE21',
        type: PromotionType.BUY_X_GET_Y,
        discountValue: 0,
        conditions: {
          productId: 'product-p',
          buyQuantity: 2,
          getQuantity: 1,
        },
      };
      promotionRepository.findOne.mockResolvedValue(bxgyPromo);
      const lines = [{ productId: 'product-p', variantId: 'a', quantity: 3, unitPrice: 100 }];
      const customer = { customerId: 'cust-eligible' };
      const storeSubtotals = new Map<string, number>();

      const preview = await validateCodeExtended(service, 'AGREE21', 300, undefined, customer, {
        mode: 'preview',
        lines,
      });
      const stacked = await applyStackedExtended(
        service,
        300,
        storeSubtotals,
        'AGREE21',
        undefined,
        customer,
        { mode: 'apply', lines },
      );

      expect(preview.discountAmount).toBe(100);
      expect(preview.freeUnits).toBe(1);
      expect(stacked.discountAmount).toBe(preview.discountAmount);
      expect(stacked.freeUnits).toBe(preview.freeUnits);
    });
  });
});
