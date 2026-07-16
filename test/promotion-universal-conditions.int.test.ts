// Promotion Universal Conditions integration Test
// Design Doc: promotion-universal-conditions-backend-design.md
// PRD: promotion-universal-conditions-prd.md (FR-1, FR-2, FR-3, FR-8)
// Generated: 2026-07-16 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// Case 1 executable (backend-task-03): in-process PromotionsService + mocked repos.
// Cases 2–3 remain comment-only until backend-task-04 / backend-task-07.
//
// Run case 1:
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
// Unit scaffold: describe('case-2: BxGy Rules A/B + MISSING_LINES vs INSUFFICIENT_QTY …')
// Deferred to backend-task-04 (comment-only until then)
// ---------------------------------------------------------------------------
//
// AC-019–AC-022 / AC-037 / AC-038: "Same-product BxGy; freeUnits = floor(Q/(X+Y))×Y;
// cheapest matching unit prices; all variants of productId sum to Q."
// AC-037 edge: "(a) lines omitted → MISSING_LINES soft/hard; (b) lines present freeUnits=0 →
// INSUFFICIENT_QTY soft preview; apply skips without throw; (c) never hard-throw solely for
// Rule A zero free."
// ROI: 90 (BV:10 × Freq:8 + Legal:0 + Defect:10)
// Behavior: validateCode BUY_X_GET_Y with lines → Rule A free count + Rule B cheapest sum;
// missing lines vs insufficient qty follow soft/hard/skip policy
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService, Promotion repository (mock), Product repository (mock when write path covered elsewhere)
// @complexity: high
// Primary failure mode: freeUnits formula uses Y per X without counting set size (X+Y); free units
// taken from wrong product; expensive units preferred; lines omitted invents Q from subtotal;
// apply hard-throws INSUFFICIENT_QTY and aborts createOrder stacking
// Proof obligation: Buy 2 Get 1 (X=2,Y=1) table — Q=2→0, Q=3→1, Q=5→1, Q=6→2; multi-variant lines
// of P with unequal unitPrices → discountAmount equals sum of cheapest freeUnits prices; foreign
// productId lines ignored; mode=preview without lines → MISSING_LINES; mode=preview Q insufficient
// → INSUFFICIENT_QTY + discount 0; mode=apply with lines and freeUnits=0 → skip (no throw).
// Boundary: MISSING_LINES vs INSUFFICIENT_QTY failure classes
// Verification points / expected results / pass criteria:
// - freeUnits matches PRD examples for Q∈{2,3,5,6}
// - discountAmount = sum of cheapest freeUnits unit prices among lines of P only
// - Preview missing lines: ineligibilityReason='MISSING_LINES', freeUnits=0
// - Apply missing lines: throws MISSING_LINES
// - Preview freeUnits=0 with lines: ineligibilityReason='INSUFFICIENT_QTY'; no throw
// - Apply freeUnits=0 with lines: no throw; discount contribution 0 (skip)
// - No free order-line mutations (discount-only)
//
// ---------------------------------------------------------------------------
// Integration test 3 of 3 — Rule C clamp + conditions write + preview/apply agreement
// Unit scaffold: describe('case-3: Rule C clamp + conditions write + preview/apply agreement …')
// Deferred to backend-task-07 (Rule C unit coverage already in promotions.service.spec.ts)
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
