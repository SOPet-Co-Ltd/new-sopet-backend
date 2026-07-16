// Promotion Universal Conditions integration Test
// Design Doc: promotion-universal-conditions-backend-design.md
// PRD: promotion-universal-conditions-prd.md (FR-1, FR-2, FR-3, FR-8)
// Generated: 2026-07-16 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// Cases 1–2 executable (backend-task-03 / backend-task-04): in-process PromotionsService + mocked repos.
// Case 3 remains comment-only until backend-task-07.
//
// Run:
//   yarn jest --config ./test/jest-e2e.json --testRegex='promotion-universal-conditions.int.test.ts$' --testPathPatterns=promotion-universal-conditions --no-coverage
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Promotion / Usage / Customer / Order / Product repositories
// @real-dependency: none (in-process service + mocked repos)

import { BadRequestException } from '@nestjs/common';
import {
  PromotionsService,
  PromotionCustomerIdentity,
  ValidateCodeOptions,
} from '../src/modules/promotions/promotions.service';
import { PromotionScope, PromotionType } from '../src/database/entities/promotion.entity';
import { OrderStatus } from '../src/database/entities/enums/order.enums';

async function validateCodeExtended(
  service: PromotionsService,
  code: string,
  subtotal: number,
  storeId: string | undefined,
  customer: PromotionCustomerIdentity | undefined,
  options: ValidateCodeOptions,
) {
  return service.validateCode(code, subtotal, storeId, customer, options);
}

/** Shared BxGy line-builder fixture (dedup across cases 2 and 3). */
function linesForQ(
  quantitiesAndPrices: Array<{ quantity: number; unitPrice: number; variantId?: string }>,
  productId = 'product-p',
) {
  return quantitiesAndPrices.map((row, index) => ({
    productId,
    variantId: row.variantId ?? `var-${index}`,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
  }));
}

describe('promotion-universal-conditions integration case-1: new-customer dual gates', () => {
  const conditionedPromo = {
    id: 'promo-newcust',
    code: 'NEWCUST10',
    name: 'New customer 10%',
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
    conditions: { newCustomer: { enabled: true, nDays: 7 } },
  };

  let service: PromotionsService;
  let promotionRepository: { findOne: jest.Mock };
  let customerRepository: { findOne: jest.Mock };
  let orderQueryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };

  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    const usageQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    orderQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockImplementation(() => {
        const calls = orderQueryBuilder.where.mock.calls as Array<
          [string, { customerId?: string } | undefined]
        >;
        const last = calls[calls.length - 1];
        const customerId = last?.[1]?.customerId;
        return Promise.resolve(customerId === 'cust-paid' ? 1 : 0);
      }),
    };
    promotionRepository = {
      findOne: jest.fn().mockResolvedValue(conditionedPromo),
    };
    customerRepository = {
      findOne: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const id = where?.id;
        if (id === 'cust-paid' || id === 'cust-non-paid-only' || id === 'cust-eligible') {
          return Promise.resolve({ id, createdAt: daysAgo(1), deletedAt: null });
        }
        if (id === 'cust-old') {
          return Promise.resolve({ id, createdAt: daysAgo(8), deletedAt: null });
        }
        return Promise.resolve(null);
      }),
    };

    service = new PromotionsService(
      promotionRepository as never,
      { createQueryBuilder: jest.fn().mockReturnValue(usageQueryBuilder) } as never,
      { findOne: jest.fn() } as never,
      customerRepository as never,
      { createQueryBuilder: jest.fn().mockReturnValue(orderQueryBuilder) } as never,
    );
  });

  // ---------------------------------------------------------------------------
  // Integration test 1 of 3 — New-customer dual gates (soft preview vs hard apply)
  // Proof obligation A–F
  // ---------------------------------------------------------------------------

  it('(A) preview guest: discountAmount=0, ineligibilityReason=GUEST', async () => {
    const result = await validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, {
      mode: 'preview',
    });
    expect(result.discountAmount).toBe(0);
    expect(result.freeUnits).toBe(0);
    expect(result.ineligibilityReason).toBe('GUEST');
  });

  it('(A) apply guest: hard-throws GUEST', async () => {
    await expect(
      validateCodeExtended(service, 'NEWCUST10', 1000, undefined, undefined, { mode: 'apply' }),
    ).rejects.toMatchObject({ response: { code: 'GUEST' } });
  });

  it('(B) preview ORDER_HISTORY soft; apply hard', async () => {
    const preview = await validateCodeExtended(
      service,
      'NEWCUST10',
      1000,
      undefined,
      { customerId: 'cust-paid' },
      { mode: 'preview' },
    );
    expect(preview.discountAmount).toBe(0);
    expect(preview.ineligibilityReason).toBe('ORDER_HISTORY');
    expect(orderQueryBuilder.andWhere).toHaveBeenCalledWith('order.status IN (:...statuses)', {
      statuses: [
        OrderStatus.PAID,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
      ],
    });

    await expect(
      validateCodeExtended(
        service,
        'NEWCUST10',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'apply' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  it('(C) non-paid-path-only history does not set ORDER_HISTORY', async () => {
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
    expect(result.ineligibilityReason).toBeNull();
  });

  it('(D) preview ACCOUNT_AGE soft; apply hard', async () => {
    const preview = await validateCodeExtended(
      service,
      'NEWCUST10',
      1000,
      undefined,
      { customerId: 'cust-old' },
      { mode: 'preview' },
    );
    expect(preview.discountAmount).toBe(0);
    expect(preview.ineligibilityReason).toBe('ACCOUNT_AGE');

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

  it('(E) both gates pass → discount applies', async () => {
    const result = await validateCodeExtended(
      service,
      'NEWCUST10',
      1000,
      undefined,
      { customerId: 'cust-eligible' },
      { mode: 'preview' },
    );
    expect(result.discountAmount).toBe(100);
    expect(result.ineligibilityReason).toBeNull();
  });

  it('(F) either-gate failure never yields positive discountAmount', async () => {
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
});

// ---------------------------------------------------------------------------
// Integration test 2 of 3 — BxGy Rules A/B + MISSING_LINES vs INSUFFICIENT_QTY
// Proof obligation: Rule A table + failure classes (backend-task-04)
// ---------------------------------------------------------------------------

describe('promotion-universal-conditions integration case-2: BxGy Rules A/B', () => {
  const bxgyPromo = {
    id: 'promo-bxgy',
    code: 'BXGY21',
    name: 'Buy 2 Get 1',
    type: PromotionType.BUY_X_GET_Y,
    scope: PromotionScope.PLATFORM,
    discountValue: 0,
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
    conditions: {
      productId: 'product-p',
      buyQuantity: 2,
      getQuantity: 1,
    },
  };

  let service: PromotionsService;

  beforeEach(() => {
    const usageQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    service = new PromotionsService(
      { findOne: jest.fn().mockResolvedValue(bxgyPromo) } as never,
      { createQueryBuilder: jest.fn().mockReturnValue(usageQueryBuilder) } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { createQueryBuilder: jest.fn() } as never,
    );
  });

  it.each([
    { Q: 2, freeUnits: 0 },
    { Q: 3, freeUnits: 1 },
    { Q: 5, freeUnits: 1 },
    { Q: 6, freeUnits: 2 },
  ])('Rule A: Buy 2 Get 1 freeUnits for Q=$Q equals $freeUnits', async ({ Q, freeUnits }) => {
    const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
      mode: 'preview',
      lines: linesForQ([{ quantity: Q, unitPrice: 100 }]),
    });
    expect(result.freeUnits).toBe(freeUnits);
  });

  it('Rule B: discountAmount = sum of cheapest freeUnits; foreign productId ignored', async () => {
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

  it('preview missing lines: MISSING_LINES soft', async () => {
    const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
      mode: 'preview',
    });
    expect(result.discountAmount).toBe(0);
    expect(result.freeUnits).toBe(0);
    expect(result.ineligibilityReason).toBe('MISSING_LINES');
  });

  it('apply missing lines: hard-throws MISSING_LINES', async () => {
    await expect(
      validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, { mode: 'apply' }),
    ).rejects.toMatchObject({ response: { code: 'MISSING_LINES' } });
  });

  it('preview freeUnits=0 with lines: INSUFFICIENT_QTY soft', async () => {
    const result = await validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
      mode: 'preview',
      lines: linesForQ([{ quantity: 2, unitPrice: 100 }]),
    });
    expect(result.discountAmount).toBe(0);
    expect(result.freeUnits).toBe(0);
    expect(result.ineligibilityReason).toBe('INSUFFICIENT_QTY');
  });

  it('apply freeUnits=0 with lines: skip without throw (I001c)', async () => {
    await expect(
      validateCodeExtended(service, 'BXGY21', 1000, undefined, undefined, {
        mode: 'apply',
        lines: linesForQ([{ quantity: 2, unitPrice: 100 }]),
      }),
    ).resolves.toMatchObject({ discountAmount: 0, freeUnits: 0, ineligibilityReason: null });
  });
});

// ---------------------------------------------------------------------------
// Integration test 3 of 3 — Rule C clamp + conditions write + preview/apply agreement
// Proof obligation (backend-task-07): Rule C V>B clamp / V<B no over-clamp; write validation vs
// evaluate path (create then re-evaluate the persisted record); preview vs applyStackedPromotions
// agreement for identical eligible fixtures.
// ---------------------------------------------------------------------------
//
// AC-015 / AC-016 / AC-036: "fixed_amount discountAmount = min(V, eligibleBase); base never < 0."
// AC-023 / AC-024: "BUY_X_GET_Y without productId rejected; valid save stores productId, X, Y."
// AC-008 / AC-001: "newCustomer.enabled + positive nDays persists; type unchanged."
// AC-035: "validatePromotion preview and createOrder stacking agree on eligible discountAmount /
// freeUnits for identical customer, lines, and codes."
// ROI: 81 (BV:9 × Freq:8 + Legal:0 + Defect:9)
// Behavior: FIXED_AMOUNT clamp regression; assertValidConditions on create/update; eligible
// preview amounts equal apply stacking amounts for same inputs
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService, Promotion / Product repositories (mock)
// @complexity: medium
// Primary failure mode: V>B yields discount V (no clamp) or negative base; BxGy saves without
// productId; preview eligible amount diverges from apply stacking for same fixtures
// Proof obligation: FIXED_AMOUNT V=100 B=60 → discountAmount=60; V=40 B=60 → 40; create/update
// BUY_X_GET_Y without productId → INVALID_BXGY_CONDITIONS; with productId+X+Y → conditions keys
// present; newCustomer enabled without positive nDays → INVALID_NEW_CUSTOMER_CONDITIONS;
// identical eligible fixtures through validateCode(preview) and applyStackedPromotions(apply)
// assert equal discountAmount and freeUnits. Boundary: write validation vs evaluate path
// Verification points / expected results / pass criteria:
// - Rule C: min(V,B) and discountAmount ≥ 0 for platform and store-subtotal bases
// - Write rejects missing/invalid BxGy productId and invalid nDays with documented codes
// - Successful write persists camelCase newCustomer / productId / buyQuantity / getQuantity
// - Eligible preview vs applyStackedPromotions: discountAmount and freeUnits match for same lines/customer/codes
// - Unconditioned percentage/fixed fixtures unchanged vs pre-feature discountAmount baselines

describe('promotion-universal-conditions integration case-3: Rule C clamp + conditions write + preview/apply agreement', () => {
  const fixedPromo = {
    id: 'promo-fixed',
    code: 'FIXEDX',
    name: 'Fixed amount',
    type: PromotionType.FIXED_AMOUNT,
    scope: PromotionScope.PLATFORM,
    discountValue: 0,
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
    create: jest.Mock;
    save: jest.Mock;
  };
  let productRepository: { findOne: jest.Mock };

  beforeEach(() => {
    const usageQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    promotionRepository = {
      findOne: jest.fn().mockResolvedValue(fixedPromo),
      create: jest.fn(),
      save: jest.fn(),
    };
    productRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'product-p', storeId: 'store-1' }),
    };
    service = new PromotionsService(
      promotionRepository as never,
      { createQueryBuilder: jest.fn().mockReturnValue(usageQueryBuilder) } as never,
      productRepository as never,
      { findOne: jest.fn() } as never,
      { createQueryBuilder: jest.fn() } as never,
    );
  });

  it('Rule C: FIXED_AMOUNT V=100 clamps to eligible base B=60 → discountAmount=60, never negative (AC-015/036)', async () => {
    promotionRepository.findOne.mockResolvedValue({ ...fixedPromo, discountValue: 100 });

    const result = await validateCodeExtended(service, 'FIXEDX', 60, undefined, undefined, {
      mode: 'apply',
    });

    expect(result.discountAmount).toBe(60);
    expect(result.discountAmount).toBeGreaterThanOrEqual(0);
  });

  it('Rule C: FIXED_AMOUNT V=40 under base B=60 → discountAmount=40, no over-clamp (AC-016)', async () => {
    promotionRepository.findOne.mockResolvedValue({ ...fixedPromo, discountValue: 40 });

    const result = await validateCodeExtended(service, 'FIXEDX', 60, undefined, undefined, {
      mode: 'apply',
    });

    expect(result.discountAmount).toBe(40);
  });

  it('write validation boundary: BUY_X_GET_Y without productId rejected before reaching evaluate path (AC-023)', async () => {
    await expect(
      service.create(
        {
          code: 'bxgy-int-bad',
          name: 'BxGy missing product',
          type: PromotionType.BUY_X_GET_Y,
          discountValue: 0,
          conditions: JSON.stringify({ buyQuantity: 2, getQuantity: 1 }),
        },
        PromotionScope.PLATFORM,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_BXGY_CONDITIONS' } });

    expect(promotionRepository.save).not.toHaveBeenCalled();
  });

  it('write validation boundary: newCustomer.enabled without positive nDays rejected (AC-008)', async () => {
    await expect(
      service.create(
        {
          code: 'newcust-int-bad',
          name: 'New customer integration bad',
          type: PromotionType.PERCENTAGE,
          discountValue: 10,
          conditions: JSON.stringify({ newCustomer: { enabled: true, nDays: 0 } }),
        },
        PromotionScope.PLATFORM,
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_NEW_CUSTOMER_CONDITIONS' } });

    expect(promotionRepository.save).not.toHaveBeenCalled();
  });

  it('write→evaluate roundtrip: valid BxGy write persists productId/buyQuantity/getQuantity, then Rule A/B evaluates on the persisted record (AC-024)', async () => {
    const conditions = { productId: 'product-p', buyQuantity: 2, getQuantity: 1 };
    const created = {
      ...fixedPromo,
      id: 'promo-bxgy-int',
      code: 'BXGYINT',
      type: PromotionType.BUY_X_GET_Y,
      discountValue: 0,
      conditions,
    };
    promotionRepository.create.mockReturnValue(created);
    promotionRepository.save.mockResolvedValue(created);

    const written = await service.create(
      {
        code: 'bxgyint',
        name: 'BxGy integration ok',
        type: PromotionType.BUY_X_GET_Y,
        discountValue: 0,
        conditions: JSON.stringify(conditions),
      },
      PromotionScope.PLATFORM,
    );

    expect(written.conditions).toMatchObject(conditions);

    // Evaluate path re-reads the just-written record — write validation vs evaluate boundary.
    promotionRepository.findOne.mockResolvedValue(written);
    const evaluated = await validateCodeExtended(service, 'BXGYINT', 300, undefined, undefined, {
      mode: 'preview',
      lines: linesForQ([{ quantity: 3, unitPrice: 100 }]),
    });

    expect(evaluated.freeUnits).toBe(1);
    expect(evaluated.discountAmount).toBe(100);
  });

  it('preview/apply agreement: eligible validateCode(preview) and applyStackedPromotions(apply) equal discountAmount and freeUnits for identical fixtures (AC-035)', async () => {
    const bxgyPromo = {
      ...fixedPromo,
      id: 'promo-agree-int',
      code: 'AGREEINT',
      type: PromotionType.BUY_X_GET_Y,
      discountValue: 0,
      conditions: { productId: 'product-p', buyQuantity: 2, getQuantity: 1 },
    };
    promotionRepository.findOne.mockResolvedValue(bxgyPromo);
    const lines = linesForQ([{ quantity: 3, unitPrice: 100 }]);
    const storeSubtotals = new Map<string, number>();

    const preview = await validateCodeExtended(service, 'AGREEINT', 300, undefined, undefined, {
      mode: 'preview',
      lines,
    });
    const stacked = await service.applyStackedPromotions(
      300,
      storeSubtotals,
      'AGREEINT',
      undefined,
      undefined,
      { mode: 'apply', lines },
    );

    expect(preview.discountAmount).toBe(100);
    expect(preview.freeUnits).toBe(1);
    expect(stacked.discountAmount).toBe(preview.discountAmount);
    expect(stacked.freeUnits).toBe(preview.freeUnits);
  });
});
