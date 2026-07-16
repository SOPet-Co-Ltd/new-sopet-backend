import { BadRequestException } from '@nestjs/common';
import {
  PromotionsService,
  PromotionCustomerIdentity,
  ValidateCodeOptions,
  ValidateCodeResult,
} from './promotions.service';
import { PromotionScope, PromotionType } from '../../database/entities/promotion.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { mapPromotion } from '../../graphql/models/mappers';

/**
 * Call site for validateCode(…, options) with mode/lines/eligibility fields.
 */
async function validateCodeExtended(
  service: PromotionsService,
  code: string,
  subtotal: number,
  storeId: string | undefined,
  customer: PromotionCustomerIdentity | undefined,
  options: ValidateCodeOptions,
): Promise<ValidateCodeResult> {
  return service.validateCode(code, subtotal, storeId, customer, options);
}

type ApplyStackedResult = {
  promotions: unknown[];
  discountAmount: number;
  discountsByPromotionId: Record<string, number>;
  freeUnits: number;
};

/**
 * Call site for applyStackedPromotions(…, options with lines).
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
  return service.applyStackedPromotions(
    subtotal,
    storeSubtotals,
    platformCode,
    storeCodes,
    customer,
    options,
  );
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
    conditions: {},
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
  let productRepository: {
    findOne: jest.Mock;
  };
  let customerRepository: {
    findOne: jest.Mock;
  };
  let orderRepository: {
    createQueryBuilder: jest.Mock;
  };
  let usageQueryBuilder: {
    innerJoin: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };
  let orderQueryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };

  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
  const daysAgo = (days: number) => hoursAgo(days * 24);

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
    productRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'product-p', storeId: 'store-1' }),
    };
    orderQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    orderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(orderQueryBuilder),
    };
    customerRepository = {
      findOne: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const id = where?.id;
        if (id === 'cust-paid') {
          return Promise.resolve({ id, createdAt: daysAgo(1), deletedAt: null });
        }
        if (id === 'cust-non-paid-only') {
          return Promise.resolve({ id, createdAt: daysAgo(1), deletedAt: null });
        }
        if (id === 'cust-old') {
          return Promise.resolve({ id, createdAt: daysAgo(8), deletedAt: null });
        }
        if (id === 'cust-eligible') {
          return Promise.resolve({ id, createdAt: daysAgo(1), deletedAt: null });
        }
        if (id === 'cust-age-boundary') {
          // Exactly at inclusive end for nDays=7: createdAt = now - 7×24h
          return Promise.resolve({ id, createdAt: daysAgo(7), deletedAt: null });
        }
        return Promise.resolve(null);
      }),
    };
    // Default: no paid-path orders; cust-paid overrides in case-1 tests
    orderQueryBuilder.getCount.mockImplementation(() => {
      const calls = orderQueryBuilder.where.mock.calls as Array<
        [string, { customerId?: string } | undefined]
      >;
      const last = calls[calls.length - 1];
      const customerId = last?.[1]?.customerId;
      if (customerId === 'cust-paid') {
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    });

    service = new PromotionsService(
      promotionRepository as never,
      promotionUsageRepository as never,
      productRepository as never,
      customerRepository as never,
      orderRepository as never,
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
    // Platform 10% of 1000 = 100; store 5% of 500 = 25
    expect(result.discountsByPromotionId).toEqual({
      'promo-1': 100,
      'promo-2': 25,
    });
    expect(result.discountAmount).toBe(125);
  });

  it('applyStackedPromotions skips BxGy freeUnits=0 without aborting (I001c)', async () => {
    const bxgyPromo = {
      ...mockPromotion,
      id: 'promo-bxgy-skip',
      code: 'BXGYSKIP',
      type: PromotionType.BUY_X_GET_Y,
      discountValue: 0,
      conditions: { productId: 'product-p', buyQuantity: 2, getQuantity: 1 },
    };
    promotionRepository.findOne.mockResolvedValue(bxgyPromo);

    const result = await applyStackedExtended(
      service,
      200,
      new Map(),
      'BXGYSKIP',
      undefined,
      undefined,
      {
        mode: 'apply',
        lines: [{ productId: 'product-p', variantId: 'a', quantity: 2, unitPrice: 100 }],
      },
    );

    expect(result.promotions).toHaveLength(0);
    expect(result.discountAmount).toBe(0);
    expect(result.discountsByPromotionId).toEqual({});
    expect(result.freeUnits).toBe(0);
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
      expect(orderQueryBuilder.andWhere).toHaveBeenCalledWith('order.status IN (:...statuses)', {
        statuses: [
          OrderStatus.PAID,
          OrderStatus.PROCESSING,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ],
      });
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

    it('enabled with invalid nDays fail-closes as ACCOUNT_AGE (preview)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...mockPromotion,
        code: 'NEWCUST10',
        conditions: { newCustomer: { enabled: true, nDays: 0 } },
      });

      const result = await validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-eligible' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('ACCOUNT_AGE');
    });

    it('enabled with missing nDays fail-closes as ACCOUNT_AGE (apply)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...mockPromotion,
        code: 'NEWCUST10',
        conditions: { newCustomer: { enabled: true } },
      });

      await expect(
        validateCodeExtended(
          service,
          'NEWCUST10',
          1000,
          undefined,
          { customerId: 'cust-eligible' },
          { mode: 'apply' },
        ),
      ).rejects.toMatchObject({ response: { code: 'ACCOUNT_AGE' } });
    });

    it('age window inclusive of end instant (createdAt + N×24h)', async () => {
      jest.useFakeTimers();
      const fixedNow = new Date('2026-07-16T12:00:00.000Z');
      jest.setSystemTime(fixedNow);
      customerRepository.findOne.mockResolvedValue({
        id: 'cust-age-boundary',
        createdAt: new Date(fixedNow.getTime() - 7 * 24 * 60 * 60 * 1000),
        deletedAt: null,
      });

      try {
        const result = await validateCodeExtended(
          service,
          'NEWCUST10',
          1000,
          undefined,
          { customerId: 'cust-age-boundary' },
          { mode: 'preview' },
        );
        expect(result.discountAmount).toBe(100);
        expect(result.ineligibilityReason).toBeNull();
      } finally {
        jest.useRealTimers();
      }
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

    it('gates off (enabled=false) → skip; discount path unchanged (AC-002)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...conditionedPromo,
        conditions: { newCustomer: { enabled: false, nDays: 7 } },
      });

      const result = await validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason).toBeNull();
    });
  });

  describe('loggedInOnly gate (AC-002–005, AC-008–009, AC-013–014, AC-018)', () => {
    const membersOnlyPromo = {
      ...mockPromotion,
      id: 'promo-members',
      code: 'MEMBERS10',
      type: PromotionType.PERCENTAGE,
      discountValue: 10,
      conditions: { loggedInOnly: { enabled: true } },
    };

    beforeEach(() => {
      promotionRepository.findOne.mockResolvedValue(membersOnlyPromo);
    });

    it('preview guest: discountAmount=0, ineligibilityReason=GUEST (AC-003/AC-018)', async () => {
      const result = await validateCodeExtended(service, 'MEMBERS10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(0);
      expect(result.freeUnits ?? 0).toBe(0);
      expect(result.ineligibilityReason).toBe('GUEST');
      expect(customerRepository.findOne).not.toHaveBeenCalled();
      expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('apply guest: hard-throws GUEST (AC-005)', async () => {
      await expect(
        validateCodeExtended(service, 'MEMBERS10', 1000, undefined, undefined, {
          mode: 'apply',
        }),
      ).rejects.toMatchObject({ response: { code: 'GUEST' } });
    });

    it('guestPhone-only identity does not satisfy gate (apply → GUEST)', async () => {
      await expect(
        validateCodeExtended(
          service,
          'MEMBERS10',
          1000,
          undefined,
          { guestPhone: '+66812345678' },
          { mode: 'apply' },
        ),
      ).rejects.toMatchObject({ response: { code: 'GUEST' } });
      expect(customerRepository.findOne).not.toHaveBeenCalled();
    });

    it('authenticated customerId passes gate; discount applies (AC-006/007 unit)', async () => {
      const result = await validateCodeExtended(
        service,
        'MEMBERS10',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason).toBeNull();
      expect(customerRepository.findOne).not.toHaveBeenCalled();
      expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('gate off when loggedInOnly absent → guest eligible on this gate (AC-014)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...membersOnlyPromo,
        conditions: {},
      });

      const result = await validateCodeExtended(service, 'MEMBERS10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason).toBeNull();
    });

    it('gate off when enabled !== true → no GUEST from this gate (AC-014)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...membersOnlyPromo,
        conditions: { loggedInOnly: { enabled: false } },
      });

      const result = await validateCodeExtended(service, 'MEMBERS10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason).toBeNull();
    });

    it('store-scoped promo hits same validateCode gate (shared evaluator)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...membersOnlyPromo,
        scope: PromotionScope.STORE,
        storeId: 'store-1',
      });

      await expect(
        validateCodeExtended(service, 'MEMBERS10', 1000, 'store-1', undefined, {
          mode: 'apply',
        }),
      ).rejects.toMatchObject({ response: { code: 'GUEST' } });
    });

    it('write normalizes ON to exactly { enabled: true } (Rule L5 / AC-013)', async () => {
      const normalized = { loggedInOnly: { enabled: true } };
      const created = {
        ...mockPromotion,
        code: 'MEMBERSON',
        conditions: normalized,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'memberson',
          name: 'Members only',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          conditions: JSON.stringify({
            loggedInOnly: { enabled: true, unknownNested: 'strip-me' },
          }),
        },
        PromotionScope.PLATFORM,
      );

      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ conditions: normalized }),
      );
      expect(result.conditions).toEqual(normalized);
      expect(result.conditions.loggedInOnly).not.toHaveProperty('unknownNested');
    });

    it('write omits loggedInOnly when filter off (Rule L5 / AC-014)', async () => {
      const normalized = { otherKey: 1 };
      const created = {
        ...mockPromotion,
        code: 'MEMBERSOFF',
        conditions: normalized,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'membersoff',
          name: 'Members off',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          conditions: JSON.stringify({
            loggedInOnly: { enabled: false },
            otherKey: 1,
          }),
        },
        PromotionScope.PLATFORM,
      );

      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ conditions: normalized }),
      );
      expect(result.conditions).toEqual(normalized);
      expect(result.conditions).not.toHaveProperty('loggedInOnly');
    });

    it.each([null, [], 'yes', 1] as const)(
      'write rejects non-plain-object loggedInOnly=%j with INVALID_LOGGED_IN_ONLY_CONDITIONS',
      async (badValue) => {
        await expect(
          service.create(
            {
              code: 'members-bad',
              name: 'Members bad',
              type: PromotionType.PERCENTAGE,
              discountValue: 10,
              conditions: JSON.stringify({ loggedInOnly: badValue }),
            },
            PromotionScope.PLATFORM,
          ),
        ).rejects.toMatchObject({ response: { code: 'INVALID_LOGGED_IN_ONLY_CONDITIONS' } });
        expect(promotionRepository.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('loggedInOnly × newCustomer composition matrix (AC-010–AC-012)', () => {
    const bothOnPromo = {
      ...mockPromotion,
      id: 'promo-both',
      code: 'BOTH10',
      type: PromotionType.PERCENTAGE,
      discountValue: 10,
      conditions: {
        loggedInOnly: { enabled: true },
        newCustomer: { enabled: true, nDays: 7 },
      },
    };

    const newCustomerOnlyPromo = {
      ...mockPromotion,
      id: 'promo-newcust',
      code: 'NEWCUST10',
      type: PromotionType.PERCENTAGE,
      discountValue: 10,
      conditions: { newCustomer: { enabled: true, nDays: 7 } },
    };

    it('newCustomer-only guest: GUEST without requiring loggedInOnly (AC-010)', async () => {
      promotionRepository.findOne.mockResolvedValue(newCustomerOnlyPromo);

      const result = await validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('GUEST');
    });

    it('both on + guest: soft GUEST; short-circuits dual-gate queries (AC-011)', async () => {
      promotionRepository.findOne.mockResolvedValue(bothOnPromo);

      const result = await validateCodeExtended(service, 'BOTH10', 1000, undefined, undefined, {
        mode: 'preview',
      });

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('GUEST');
      expect(customerRepository.findOne).not.toHaveBeenCalled();
      expect(orderRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('both on + guest apply: hard-throws GUEST (AC-011)', async () => {
      promotionRepository.findOne.mockResolvedValue(bothOnPromo);

      await expect(
        validateCodeExtended(service, 'BOTH10', 1000, undefined, undefined, { mode: 'apply' }),
      ).rejects.toMatchObject({ response: { code: 'GUEST' } });
      expect(customerRepository.findOne).not.toHaveBeenCalled();
    });

    it('both on + paid-path: ORDER_HISTORY (AND composition; AC-012)', async () => {
      promotionRepository.findOne.mockResolvedValue(bothOnPromo);

      const result = await validateCodeExtended(
        service,
        'BOTH10',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('ORDER_HISTORY');
      expect(customerRepository.findOne).toHaveBeenCalled();
      expect(orderRepository.createQueryBuilder).toHaveBeenCalled();
    });

    it('both on + old account: ACCOUNT_AGE (AND composition; AC-012)', async () => {
      promotionRepository.findOne.mockResolvedValue(bothOnPromo);

      const result = await validateCodeExtended(
        service,
        'BOTH10',
        1000,
        undefined,
        { customerId: 'cust-old' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(0);
      expect(result.ineligibilityReason).toBe('ACCOUNT_AGE');
    });

    it('both on + eligible new customer: discount applies (AC-012)', async () => {
      promotionRepository.findOne.mockResolvedValue(bothOnPromo);

      const result = await validateCodeExtended(
        service,
        'BOTH10',
        1000,
        undefined,
        { customerId: 'cust-eligible' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(100);
      expect(result.ineligibilityReason).toBeNull();
    });

    it('FIXED_AMOUNT both-on + eligible: type math still applies (adjacent unconditioned path)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...bothOnPromo,
        type: PromotionType.FIXED_AMOUNT,
        discountValue: 50,
      });

      const result = await validateCodeExtended(
        service,
        'BOTH10',
        1000,
        undefined,
        { customerId: 'cust-eligible' },
        { mode: 'preview' },
      );

      expect(result.discountAmount).toBe(50);
      expect(result.ineligibilityReason).toBeNull();
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
      // Q=6 → freeUnits=2; multiset prices 50,80,100,110,120,130 → cheapest two = 50+80 = 130
      const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'preview',
        lines: [
          { productId: 'product-p', variantId: 'a', quantity: 1, unitPrice: 50 },
          { productId: 'product-p', variantId: 'b', quantity: 1, unitPrice: 80 },
          { productId: 'product-p', variantId: 'c', quantity: 1, unitPrice: 100 },
          { productId: 'product-p', variantId: 'd', quantity: 1, unitPrice: 110 },
          { productId: 'product-p', variantId: 'e', quantity: 1, unitPrice: 120 },
          { productId: 'product-p', variantId: 'f', quantity: 1, unitPrice: 130 },
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

    it('rejects when matching BxGy unit quantity exceeds MAX (QUANTITY_TOO_LARGE)', async () => {
      await expect(
        validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'preview',
          lines: linesForQ([{ quantity: 1000, unitPrice: 100 }]),
        }),
      ).rejects.toMatchObject({ response: { code: 'QUANTITY_TOO_LARGE' } });
    });

    it('rejects when summed matching lines exceed MAX (QUANTITY_TOO_LARGE)', async () => {
      await expect(
        validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'preview',
          lines: [
            { productId: 'product-p', variantId: 'a', quantity: 500, unitPrice: 100 },
            { productId: 'product-p', variantId: 'b', quantity: 500, unitPrice: 100 },
          ],
        }),
      ).rejects.toMatchObject({ response: { code: 'QUANTITY_TOO_LARGE' } });
    });

    it('allows matching quantity at MAX without QUANTITY_TOO_LARGE', async () => {
      const result = await validateCodeExtended(service, 'BXGY21', 99900, undefined, undefined, {
        mode: 'preview',
        lines: linesForQ([{ quantity: 999, unitPrice: 100 }]),
      });

      expect(result.freeUnits).toBe(333);
      expect(result.ineligibilityReason).toBeNull();
    });

    it('apply freeUnits=0 with lines: skip without throw (AC-037b/c)', async () => {
      await expect(
        validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
          mode: 'apply',
          lines: linesForQ([{ quantity: 2, unitPrice: 100 }]),
        }),
      ).resolves.toMatchObject({ discountAmount: 0 });
    });

    it('Rule B tie-break: equal prices prefer earlier line index over variantId (AC-020 step 6)', async () => {
      // Q=3 → freeUnits=1; both cheap lines @50 — line index 0 wins over lexicographically smaller variantId on line 1
      const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'preview',
        lines: [
          { productId: 'product-p', variantId: 'zzz', quantity: 1, unitPrice: 50 },
          { productId: 'product-p', variantId: 'aaa', quantity: 1, unitPrice: 50 },
          { productId: 'product-p', variantId: 'mid', quantity: 1, unitPrice: 200 },
        ],
      });

      expect(result.freeUnits).toBe(1);
      expect(result.discountAmount).toBe(50);
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

    it('write rejects malformed conditions JSON (INVALID_CONDITIONS)', async () => {
      await expect(
        service.create(
          {
            code: 'bad-json',
            name: 'Bad JSON',
            type: PromotionType.PERCENTAGE,
            discountValue: 10,
            conditions: '{not-json',
          },
          PromotionScope.PLATFORM,
        ),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CONDITIONS' } });
    });

    it('write rejects BxGy when productId does not exist (PRODUCT_NOT_FOUND)', async () => {
      productRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          {
            code: 'bxgy-missing',
            name: 'BxGy missing product',
            type: PromotionType.BUY_X_GET_Y,
            discountValue: 0,
            conditions: JSON.stringify({
              productId: 'missing-product',
              buyQuantity: 2,
              getQuantity: 1,
            }),
          },
          PromotionScope.PLATFORM,
        ),
      ).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
    });

    it('write rejects store-scope BxGy when product belongs to another store (PRODUCT_STORE_MISMATCH)', async () => {
      productRepository.findOne.mockResolvedValue({ id: 'product-p', storeId: 'other-store' });

      await expect(
        service.create(
          {
            code: 'bxgy-mismatch',
            name: 'BxGy store mismatch',
            type: PromotionType.BUY_X_GET_Y,
            discountValue: 0,
            conditions: JSON.stringify({
              productId: 'product-p',
              buyQuantity: 2,
              getQuantity: 1,
            }),
          },
          PromotionScope.STORE,
          'store-1',
        ),
      ).rejects.toMatchObject({ response: { code: 'PRODUCT_STORE_MISMATCH' } });
    });

    it('update rejects BUY_X_GET_Y without productId (AC-023)', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...mockPromotion,
        type: PromotionType.BUY_X_GET_Y,
        scope: PromotionScope.PLATFORM,
        conditions: {},
      });

      await expect(
        service.update('promo-1', {
          conditions: JSON.stringify({ buyQuantity: 2, getQuantity: 1 }),
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_BXGY_CONDITIONS' } });
    });

    it('write accepts ADR example JSON and ignores unknown keys', async () => {
      const conditions = {
        newCustomer: { enabled: true, nDays: 30 },
        productId: 'product-p',
        buyQuantity: 2,
        getQuantity: 1,
        futureKey: 'ignored',
      };
      const created = {
        ...mockPromotion,
        id: 'promo-adr',
        code: 'ADREX',
        type: PromotionType.PERCENTAGE,
        discountValue: 10,
        conditions,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'adrex',
          name: 'ADR example',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          conditions: JSON.stringify(conditions),
        },
        PromotionScope.PLATFORM,
      );

      expect(result.conditions).toMatchObject({
        newCustomer: { enabled: true, nDays: 30 },
        productId: 'product-p',
        buyQuantity: 2,
        getQuantity: 1,
      });
      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PromotionType.PERCENTAGE,
          conditions,
        }),
      );
      expect(productRepository.findOne).not.toHaveBeenCalled();
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

  // -------------------------------------------------------------------------
  // ADR-0008 / Backend contract freeze — optional autoApply persist + map
  // -------------------------------------------------------------------------
  describe('autoApply persist and map (contract freeze)', () => {
    it('create persists autoApply true and priority when provided', async () => {
      const created = {
        ...mockPromotion,
        code: 'AUTO10',
        autoApply: true,
        priority: 10,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'auto10',
          name: 'Auto 10%',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          autoApply: true,
          priority: 10,
        },
        PromotionScope.PLATFORM,
      );

      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ autoApply: true, priority: 10 }),
      );
      expect(result.autoApply).toBe(true);
      expect(result.priority).toBe(10);
      expect(mapPromotion(result as never).autoApply).toBe(true);
      expect(mapPromotion(result as never).priority).toBe(10);
    });

    it('create defaults autoApply false and priority 0 when omitted', async () => {
      const created = {
        ...mockPromotion,
        code: 'MANUAL10',
        autoApply: false,
        priority: 0,
      };
      promotionRepository.create = jest.fn().mockReturnValue(created);
      promotionRepository.save = jest.fn().mockResolvedValue(created);

      const result = await service.create(
        {
          code: 'manual10',
          name: 'Manual 10%',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
        },
        PromotionScope.PLATFORM,
      );

      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ autoApply: false, priority: 0 }),
      );
      expect(result.autoApply).toBe(false);
      expect(result.priority).toBe(0);
      expect(mapPromotion(result as never).autoApply).toBe(false);
      expect(mapPromotion(result as never).priority).toBe(0);
    });

    it('update persists autoApply and priority when provided', async () => {
      const existing = {
        ...mockPromotion,
        autoApply: false,
        priority: 0,
      };
      promotionRepository.findOne.mockResolvedValue(existing);
      promotionRepository.save = jest
        .fn()
        .mockImplementation((entity: typeof existing) => Promise.resolve(entity));

      const result = await service.update('promo-1', { autoApply: true, priority: 5 });

      expect(result.autoApply).toBe(true);
      expect(result.priority).toBe(5);
      expect(mapPromotion(result as never).autoApply).toBe(true);
      expect(mapPromotion(result as never).priority).toBe(5);
    });

    it('findActive returns both autoApply true and false rows (no autoApply filter)', async () => {
      const mixed = [
        { ...mockPromotion, id: 'auto-1', code: 'AUTO', autoApply: true, priority: 2 },
        { ...mockPromotion, id: 'manual-1', code: 'MANUAL', autoApply: false, priority: 1 },
      ];
      const andWhere = jest.fn().mockReturnThis();
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mixed),
      };
      promotionRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.findActive();

      expect(result).toHaveLength(2);
      expect(result.map((p) => p.autoApply).sort()).toEqual([false, true]);
      const andWhereSql = andWhere.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(andWhereSql.some((sql) => /auto_?apply/i.test(sql))).toBe(false);
      expect(mapPromotion(result[0] as never).autoApply).toBe(true);
      expect(mapPromotion(result[1] as never).autoApply).toBe(false);
    });

    it('findActiveForStore returns both autoApply true and false rows (no autoApply filter)', async () => {
      const mixed = [
        {
          ...mockPromotion,
          id: 'store-auto',
          code: 'SAUTO',
          scope: PromotionScope.STORE,
          storeId: 'store-1',
          autoApply: true,
          priority: 3,
        },
        {
          ...mockPromotion,
          id: 'store-manual',
          code: 'SMANUAL',
          scope: PromotionScope.STORE,
          storeId: 'store-1',
          autoApply: false,
          priority: 0,
        },
      ];
      const andWhere = jest.fn().mockReturnThis();
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mixed),
      };
      promotionRepository.createQueryBuilder = jest.fn().mockReturnValue(qb);

      const result = await service.findActiveForStore('store-1');

      expect(result).toHaveLength(2);
      expect(result.some((p) => p.autoApply === true)).toBe(true);
      expect(result.some((p) => p.autoApply === false)).toBe(true);
      const andWhereSql = andWhere.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(andWhereSql.some((sql) => /auto_?apply/i.test(sql))).toBe(false);
      expect(mapPromotion(result[0] as never).priority).toBe(3);
      expect(mapPromotion(result[1] as never).priority).toBe(0);
    });
  });
});
