// Promotion List-Time Eligibility [integration] Test — Decision 6 delta
// Design Doc: promotion-universal-conditions-backend-design.md (§ Delta Decision 6)
// PRD: promotion-universal-conditions-prd.md (FR-12 / AC-041 server, AC-046–AC-048)
// Generated: 2026-07-17 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// Delta-named (not appended to promotion-universal-conditions.int.test.ts): Decision 5
// integration budget is already 3/3. Executable against validatePromotionsBatch (task-1.1/1.3).
//
// Run:
//   yarn jest --config ./test/jest-e2e.json --testRegex='promotion-list-time-eligibility.int.test.ts$' --no-coverage
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries + Delta):
// Mock: Promotion / Usage / Customer / Order / Product repositories
// @real-dependency: none (in-process PromotionsService + mocked repos)
//
// ---------------------------------------------------------------------------
// Integration test 1 of 3 — Batch ↔ single preview agreement (AC-048)
// ---------------------------------------------------------------------------
//
// AC-048: "When the same customer, lines, and targets are evaluated via
// validatePromotions (batch) and validatePromotion / validateCode preview, then soft
// reason codes and eligible amounts agree for shared soft gates."
// ROI: 89 (BV:10 × Freq:8 + Legal:0 + Defect:9)
// Behavior: Same resolved promotion + cart/customer → batch item soft codes and
// discountAmount/freeUnits equal validateCode(..., { mode:'preview' })
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validatePromotionsBatch, validateCode (shared evaluators)
// @complexity: high
// Primary failure mode: batch soft reason or eligible amount diverges from single
// preview for identical inputs (esp. ORDER_HISTORY / ACCOUNT_AGE / GUEST /
// INSUFFICIENT_QTY / MISSING_LINES / soft PROMOTION_MIN_PURCHASE)
// Proof obligation: For each soft-gate fixture (guest GUEST; returning ORDER_HISTORY;
// age ACCOUNT_AGE; BxGy MISSING_LINES / INSUFFICIENT_QTY; min-purchase soft in batch),
// assert batch item.ineligibilityReason and discountAmount/freeUnits ===
// validateCode preview for the same resolved promo + context. Eligible path: batch
// eligible amounts match preview. Apply/createOrder may still deny — agreement is
// soft-preview only. Boundary: shared evaluator path (not a forked batch math).
// Verification points / expected results / pass criteria:
// - Soft ineligibilityReason codes match 1:1 between batch item and validateCode preview
// - discountAmount and freeUnits match on eligible and soft-ineligible soft paths
// - Structural codes softened only in batch transport still equal the soft reason the
//   batch matrix documents; single preview hard-throw behavior unchanged (separate assert)
// - No positive discountAmount when any soft gate fails
//
// ---------------------------------------------------------------------------
// Integration test 2 of 3 — Soft per-item batch matrix (AC-046)
// ---------------------------------------------------------------------------
//
// AC-046: "When storefront sends a set of promotion ids/codes + cart context in one
// validatePromotions call, then the API returns one ValidatePromotionsResult with
// per-item soft outcomes."
// ROI: 81 (BV:9 × Freq:8 + Legal:0 + Defect:9)
// Behavior: Multi-target batch → one result slot per input; one unresolved/inactive/
// structural failure softens that item only; siblings remain evaluable
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validatePromotionsBatch
// @complexity: high
// Primary failure mode: one bad target fails the whole query; items.length !==
// promotions.length; structural codes hard-throw inside batch; duplicate targets
// incorrectly deduped
// Proof obligation: Batch of mixed targets (valid eligible, INVALID_PROMOTION id,
// soft PROMOTION_MIN_PURCHASE, soft GUEST, soft PROMOTION_EXPIRED/dates-limits-store)
// → items.length === input length in order; bad slot eligible=false + documented soft
// code; other slots unaffected. Cap: empty or >20 targets → whole-query
// INVALID_VALIDATE_PROMOTIONS_INPUT (not soft item). Id-then-code resolution +
// mismatch → soft INVALID_PROMOTION.
// Boundary: soft-per-item vs whole-query at service layer (empty/>20 only).
// Residual (ValidationPipe / GraphQL, not asserted here): missing both id+code,
// invalid target shape (`{}`) — class-validator at transport boundary.
// Verification points / expected results / pass criteria:
// - items.length === promotions.length; order preserved; no server-side dedupe
// - Unresolved/inactive → soft INVALID_PROMOTION; siblings still soft-evaluated
// - Soft structural codes per Delta Soft/Hard Matrix (min purchase, dates/limits/store)
//   with ≥1 dates/limits/store soft-per-item assert (e.g. PROMOTION_EXPIRED) + siblings
// - Whole-query at service layer: empty/>20 only → INVALID_VALIDATE_PROMOTIONS_INPUT
// - Residual: missing both id+code / invalid shape → ValidationPipe/GraphQL (not whole-query
//   asserts for `{}` targets at this service-int boundary)
// - Echo resolved id/code/name on items when row loaded
//
// ---------------------------------------------------------------------------
// Integration test 3 of 3 — Batch new-customer soft gates + identity cache (AC-041)
// ---------------------------------------------------------------------------
//
// AC-041 (server half): "When a logged-in customer fails new-customer dual gates,
// then batch preview returns soft ORDER_HISTORY and/or ACCOUNT_AGE with
// eligible=false without requiring apply."
// ROI: 80 (BV:9 × Freq:8 + Legal:0 + Defect:8)
// Behavior: Batch of ≤20 newCustomer-conditioned promos for same customer → soft
// ORDER_HISTORY / ACCOUNT_AGE; Customer load + paid-path COUNT memoized once per request
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService.validatePromotionsBatch, evaluateNewCustomerGates
// @complexity: medium
// Primary failure mode: batch requires apply to surface NOT_NEW_CUSTOMER family codes;
// N× identical Customer find / paid-path COUNT for same identity in one batch
// Proof obligation: Returning customer (paid-path history) → each conditioned item
// eligible=false, ineligibilityReason=ORDER_HISTORY (or ACCOUNT_AGE for age fail);
// assert customerRepository.findOne and order COUNT invoked once per batch request
// for that identity (identity-scoped cache), not once per target. Guest → soft GUEST.
// Boundary: request-local memoization vs per-promo re-query.
// Verification points / expected results / pass criteria:
// - Soft ORDER_HISTORY / ACCOUNT_AGE on batch items without apply
// - eligible=false and discountAmount=0 on gate failure
// - Same soft codes as validateCode preview (cross-check with test 1 fixtures)
// - ≤20 conditioned targets: one Customer load + one paid-path COUNT per identity
// - AC-047 note: this path is validatePromotions only — active* lists stay catalog-only
//   (no eligibility fields asserted here; schema/unit covers PromotionType map)

import {
  PromotionsService,
  PromotionCustomerIdentity,
  ValidateCodeOptions,
  ValidateCodeResult,
} from '../src/modules/promotions/promotions.service';
import { PromotionScope, PromotionType } from '../src/database/entities/promotion.entity';
import { mapPromotion } from '../src/graphql/models/mappers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const ELIGIBILITY_KEYS = [
  'eligible',
  'ineligibilityReason',
  'discountAmount',
  'freeUnits',
] as const;

function assertNoEligibilityFields(mapped: Record<string, unknown>): void {
  for (const key of ELIGIBILITY_KEYS) {
    expect(Object.prototype.hasOwnProperty.call(mapped, key)).toBe(false);
  }
}

describe('promotion-list-time-eligibility integration', () => {
  const basePromo = {
    id: 'promo-percent',
    code: 'WELCOME10',
    name: 'Welcome 10%',
    type: PromotionType.PERCENTAGE,
    scope: PromotionScope.PLATFORM,
    discountValue: 10,
    minPurchaseAmount: null as number | null,
    maxDiscountAmount: null as number | null,
    usageLimit: null as number | null,
    usagePerCustomer: 1,
    usageCount: 0,
    isActive: true,
    autoApply: false,
    priority: 0,
    startsAt: null as Date | null,
    expiresAt: null as Date | null,
    storeId: null as string | null,
    deletedAt: null as Date | null,
    description: null as string | null,
    conditions: {} as Record<string, unknown>,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };

  const percentPromo = { ...basePromo };

  const newCustomerPromo = {
    ...basePromo,
    id: 'promo-newcust',
    code: 'NEWCUST10',
    name: 'New Customer 10%',
    conditions: { newCustomer: { enabled: true, nDays: 7 } },
  };

  const minPurchasePromo = {
    ...basePromo,
    id: 'promo-min',
    code: 'MIN500',
    name: 'Min 500',
    minPurchaseAmount: 500,
  };

  const bxgyPromo = {
    ...basePromo,
    id: 'promo-bxgy',
    code: 'BXGY21',
    name: 'Buy 2 Get 1',
    type: PromotionType.BUY_X_GET_Y,
    discountValue: 0,
    conditions: { productId: 'product-p', buyQuantity: 2, getQuantity: 1 },
  };

  let service: PromotionsService;
  let promotionRepository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let customerRepository: { findOne: jest.Mock };
  let orderRepository: { createQueryBuilder: jest.Mock };
  let orderQueryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
  };

  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const promoByKey = (where: { id?: string; code?: string }) => {
    const catalog = [percentPromo, newCustomerPromo, minPurchasePromo, bxgyPromo];
    if (where?.id) {
      return catalog.find((p) => p.id === where.id) ?? null;
    }
    if (where?.code) {
      return catalog.find((p) => p.code === where.code && p.isActive) ?? null;
    }
    return null;
  };

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
      findOne: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string; code?: string } }) =>
          Promise.resolve(promoByKey(where)),
        ),
      createQueryBuilder: jest.fn(),
    };
    customerRepository = {
      findOne: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const id = where?.id;
        if (id === 'cust-paid' || id === 'cust-eligible' || id === 'cust-non-paid-only') {
          return Promise.resolve({ id, createdAt: daysAgo(1), deletedAt: null });
        }
        if (id === 'cust-old') {
          return Promise.resolve({ id, createdAt: daysAgo(8), deletedAt: null });
        }
        return Promise.resolve(null);
      }),
    };
    orderRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(orderQueryBuilder),
    };

    service = new PromotionsService(
      promotionRepository as never,
      { createQueryBuilder: jest.fn().mockReturnValue(usageQueryBuilder) } as never,
      { findOne: jest.fn().mockResolvedValue({ id: 'product-p', storeId: 'store-1' }) } as never,
      customerRepository as never,
      orderRepository as never,
    );
  });

  // -------------------------------------------------------------------------
  // Case 1 — AC-048 batch ↔ single preview agreement
  // -------------------------------------------------------------------------
  describe('case-1: batch ↔ single preview agreement (AC-048)', () => {
    async function assertBatchMatchesPreview(
      code: string,
      subtotal: number,
      customer: PromotionCustomerIdentity | undefined,
      lines?: ValidateCodeOptions['lines'],
    ) {
      const preview = await validateCodeExtended(service, code, subtotal, undefined, customer, {
        mode: 'preview',
        lines,
      });
      const batch = await service.validatePromotionsBatch(
        [{ code }],
        subtotal,
        undefined,
        customer,
        lines,
      );

      expect(batch.items).toHaveLength(1);
      expect(batch.items[0].ineligibilityReason).toBe(preview.ineligibilityReason);
      expect(batch.items[0].discountAmount).toBe(preview.discountAmount);
      expect(batch.items[0].freeUnits).toBe(preview.freeUnits ?? 0);
      if (preview.ineligibilityReason) {
        expect(batch.items[0].eligible).toBe(false);
        expect(batch.items[0].discountAmount).toBe(0);
      }
      return batch.items[0];
    }

    it('eligible %-off: batch amounts match validateCode preview', async () => {
      const preview = await validateCodeExtended(service, 'WELCOME10', 1000, undefined, undefined, {
        mode: 'preview',
      });
      const batch = await service.validatePromotionsBatch([{ code: 'WELCOME10' }], 1000);

      expect(preview.ineligibilityReason).toBeNull();
      expect(preview.discountAmount).toBe(100);
      expect(batch.items[0].eligible).toBe(true);
      expect(batch.items[0].discountAmount).toBe(preview.discountAmount);
      expect(batch.items[0].freeUnits).toBe(preview.freeUnits ?? 0);
      expect(batch.items[0].ineligibilityReason).toBeNull();
    });

    it('GUEST soft: batch reason/amount matches preview', async () => {
      const item = await assertBatchMatchesPreview('NEWCUST10', 1000, undefined);
      expect(item.ineligibilityReason).toBe('GUEST');
    });

    it('ORDER_HISTORY soft: batch reason/amount matches preview', async () => {
      const item = await assertBatchMatchesPreview('NEWCUST10', 1000, {
        customerId: 'cust-paid',
      });
      expect(item.ineligibilityReason).toBe('ORDER_HISTORY');
    });

    it('ACCOUNT_AGE soft: batch reason/amount matches preview', async () => {
      const item = await assertBatchMatchesPreview('NEWCUST10', 1000, {
        customerId: 'cust-old',
      });
      expect(item.ineligibilityReason).toBe('ACCOUNT_AGE');
    });

    it('BxGy MISSING_LINES soft: batch matches preview', async () => {
      const item = await assertBatchMatchesPreview('BXGY21', 300, undefined, undefined);
      expect(item.ineligibilityReason).toBe('MISSING_LINES');
    });

    it('BxGy INSUFFICIENT_QTY soft: batch matches preview', async () => {
      const lines = [{ productId: 'product-p', variantId: 'v1', quantity: 2, unitPrice: 100 }];
      const item = await assertBatchMatchesPreview('BXGY21', 200, undefined, lines);
      expect(item.ineligibilityReason).toBe('INSUFFICIENT_QTY');
    });

    it('PROMOTION_MIN_PURCHASE soft in batch; single preview still hard (matrix)', async () => {
      const batch = await service.validatePromotionsBatch([{ code: 'MIN500' }], 100);
      expect(batch.items[0].eligible).toBe(false);
      expect(batch.items[0].ineligibilityReason).toBe('PROMOTION_MIN_PURCHASE');
      expect(batch.items[0].discountAmount).toBe(0);

      await expect(
        validateCodeExtended(service, 'MIN500', 100, undefined, undefined, { mode: 'preview' }),
      ).rejects.toMatchObject({ response: { code: 'PROMOTION_MIN_PURCHASE' } });
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 — AC-046 soft per-item batch matrix
  // -------------------------------------------------------------------------
  describe('case-2: soft per-item batch matrix (AC-046)', () => {
    it('mixed targets: length/order preserved; bad slot soft; siblings evaluable', async () => {
      const targets = [
        { code: 'WELCOME10' },
        { id: 'missing-id' },
        { code: 'MIN500' },
        { code: 'NEWCUST10' },
      ];

      const result = await service.validatePromotionsBatch(targets, 100);

      expect(result.items).toHaveLength(4);
      expect(result.items[0].eligible).toBe(true);
      expect(result.items[0].code).toBe('WELCOME10');
      expect(result.items[0].discountAmount).toBe(10);

      expect(result.items[1].eligible).toBe(false);
      expect(result.items[1].ineligibilityReason).toBe('INVALID_PROMOTION');
      expect(result.items[1].id).toBeNull();

      expect(result.items[2].eligible).toBe(false);
      expect(result.items[2].ineligibilityReason).toBe('PROMOTION_MIN_PURCHASE');
      // Code-only structural soft: catch path echoes input code (id set when resolved via id)
      expect(result.items[2].code).toBe('MIN500');
      expect(result.items[2].discountAmount).toBe(0);

      expect(result.items[3].eligible).toBe(false);
      expect(result.items[3].ineligibilityReason).toBe('GUEST');
      expect(result.items[3].discountAmount).toBe(0);
    });

    it('id-resolved structural soft echoes id/code/name', async () => {
      const result = await service.validatePromotionsBatch([{ id: minPurchasePromo.id }], 100);

      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('PROMOTION_MIN_PURCHASE');
      expect(result.items[0].id).toBe(minPurchasePromo.id);
      expect(result.items[0].code).toBe(minPurchasePromo.code);
      expect(result.items[0].name).toBe(minPurchasePromo.name);
    });

    it('PROMOTION_EXPIRED soft-per-item; siblings still evaluable', async () => {
      const expiredPromo = {
        ...percentPromo,
        id: 'promo-expired',
        code: 'EXPIRED10',
        name: 'Expired 10%',
        expiresAt: new Date('2020-01-01'),
      };
      promotionRepository.findOne.mockImplementation(
        ({ where }: { where: { id?: string; code?: string } }) => {
          if (where?.id === expiredPromo.id || where?.code === expiredPromo.code) {
            return Promise.resolve(expiredPromo);
          }
          return Promise.resolve(promoByKey(where));
        },
      );

      const result = await service.validatePromotionsBatch(
        [{ code: 'EXPIRED10' }, { code: 'WELCOME10' }, { id: 'missing-id' }],
        1000,
      );

      expect(result.items).toHaveLength(3);
      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('PROMOTION_EXPIRED');
      expect(result.items[0].discountAmount).toBe(0);

      expect(result.items[1].eligible).toBe(true);
      expect(result.items[1].code).toBe('WELCOME10');
      expect(result.items[1].discountAmount).toBe(100);

      expect(result.items[2].eligible).toBe(false);
      expect(result.items[2].ineligibilityReason).toBe('INVALID_PROMOTION');
    });

    it('duplicate slots: no server dedupe; items.length === promotions.length', async () => {
      const result = await service.validatePromotionsBatch(
        [{ code: 'WELCOME10' }, { code: 'WELCOME10' }, { id: percentPromo.id }],
        1000,
      );

      expect(result.items).toHaveLength(3);
      expect(result.items.every((i) => i.eligible && i.code === 'WELCOME10')).toBe(true);
    });

    it('id + mismatched code → soft INVALID_PROMOTION', async () => {
      const result = await service.validatePromotionsBatch(
        [{ id: percentPromo.id, code: 'WRONGCODE' }],
        1000,
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('INVALID_PROMOTION');
    });

    it('inactive resolved by id → soft INVALID_PROMOTION; echoes id/code/name', async () => {
      promotionRepository.findOne.mockResolvedValue({
        ...percentPromo,
        isActive: false,
      });

      const result = await service.validatePromotionsBatch([{ id: percentPromo.id }], 1000);
      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('INVALID_PROMOTION');
      expect(result.items[0].id).toBe(percentPromo.id);
      expect(result.items[0].code).toBe(percentPromo.code);
      expect(result.items[0].name).toBe(percentPromo.name);
    });

    // Whole-query at service layer: empty / >20 only.
    // Residual — missing both id+code and invalid shape (`{}`) → ValidationPipe/GraphQL
    // (ValidatePromotionsTargetInput); do not assert whole-query for `{}` here.
    it('empty targets → whole-query INVALID_VALIDATE_PROMOTIONS_INPUT', async () => {
      await expect(service.validatePromotionsBatch([], 1000)).rejects.toMatchObject({
        response: { code: 'INVALID_VALIDATE_PROMOTIONS_INPUT' },
      });
    });

    it('>20 targets → whole-query INVALID_VALIDATE_PROMOTIONS_INPUT', async () => {
      const targets = Array.from({ length: 21 }, (_, i) => ({ code: `C${i}` }));
      await expect(service.validatePromotionsBatch(targets, 1000)).rejects.toMatchObject({
        response: { code: 'INVALID_VALIDATE_PROMOTIONS_INPUT' },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Case 3 — AC-041 new-customer soft gates + identity cache (+ AC-047)
  // -------------------------------------------------------------------------
  describe('case-3: batch new-customer soft gates + identity cache (AC-041)', () => {
    it('returning customer: soft ORDER_HISTORY without apply; discountAmount=0', async () => {
      const promoA = { ...newCustomerPromo, id: 'nc-a', code: 'NCA' };
      const promoB = { ...newCustomerPromo, id: 'nc-b', code: 'NCB' };
      promotionRepository.findOne.mockImplementation(
        ({ where }: { where: { id?: string; code?: string } }) => {
          if (where?.code === 'NCA' || where?.id === 'nc-a') {
            return Promise.resolve(promoA);
          }
          if (where?.code === 'NCB' || where?.id === 'nc-b') {
            return Promise.resolve(promoB);
          }
          return Promise.resolve(null);
        },
      );

      const result = await service.validatePromotionsBatch(
        [{ code: 'NCA' }, { code: 'NCB' }],
        1000,
        undefined,
        { customerId: 'cust-paid' },
      );

      expect(result.items).toHaveLength(2);
      for (const item of result.items) {
        expect(item.eligible).toBe(false);
        expect(item.ineligibilityReason).toBe('ORDER_HISTORY');
        expect(item.discountAmount).toBe(0);
      }

      const preview = await validateCodeExtended(
        service,
        'NCA',
        1000,
        undefined,
        { customerId: 'cust-paid' },
        { mode: 'preview' },
      );
      expect(preview.ineligibilityReason).toBe('ORDER_HISTORY');
    });

    it('old account: soft ACCOUNT_AGE without apply', async () => {
      promotionRepository.findOne.mockResolvedValue(newCustomerPromo);

      const result = await service.validatePromotionsBatch(
        [{ code: 'NEWCUST10' }],
        1000,
        undefined,
        { customerId: 'cust-old' },
      );

      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('ACCOUNT_AGE');
      expect(result.items[0].discountAmount).toBe(0);
    });

    it('guest: soft GUEST without apply', async () => {
      promotionRepository.findOne.mockResolvedValue(newCustomerPromo);

      const result = await service.validatePromotionsBatch([{ code: 'NEWCUST10' }], 1000);

      expect(result.items[0].eligible).toBe(false);
      expect(result.items[0].ineligibilityReason).toBe('GUEST');
      expect(result.items[0].discountAmount).toBe(0);
    });

    it('identity-scoped gate cache: Customer find + Order COUNT once per customerId', async () => {
      const promoA = { ...newCustomerPromo, id: 'nc-a', code: 'NCA' };
      const promoB = { ...newCustomerPromo, id: 'nc-b', code: 'NCB' };
      promotionRepository.findOne.mockImplementation(
        ({ where }: { where: { id?: string; code?: string } }) => {
          if (where?.code === 'NCA' || where?.id === 'nc-a') {
            return Promise.resolve(promoA);
          }
          if (where?.code === 'NCB' || where?.id === 'nc-b') {
            return Promise.resolve(promoB);
          }
          return Promise.resolve(null);
        },
      );

      customerRepository.findOne.mockClear();
      orderRepository.createQueryBuilder.mockClear();

      await service.validatePromotionsBatch([{ code: 'NCA' }, { code: 'NCB' }], 1000, undefined, {
        customerId: 'cust-paid',
      });

      expect(orderRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(customerRepository.findOne).toHaveBeenCalledTimes(1);
    });

    it('AC-047: active* catalog mapping has no eligibility fields', async () => {
      const platformRows = [
        { ...percentPromo, id: 'plat-1', code: 'P1', autoApply: true, priority: 2 },
        { ...newCustomerPromo, id: 'plat-2', code: 'P2', autoApply: false, priority: 1 },
      ];
      const storeRows = [
        {
          ...percentPromo,
          id: 'store-1-promo',
          code: 'S1',
          scope: PromotionScope.STORE,
          storeId: 'store-1',
          autoApply: false,
          priority: 0,
        },
      ];

      const platformQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(platformRows),
      };
      const storeQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(storeRows),
      };
      promotionRepository.createQueryBuilder
        .mockReturnValueOnce(platformQb)
        .mockReturnValueOnce(storeQb);

      const platform = await service.findActive();
      const store = await service.findActiveForStore('store-1');

      expect(platform).toHaveLength(2);
      expect(store).toHaveLength(1);

      for (const row of [...platform, ...store]) {
        assertNoEligibilityFields(mapPromotion(row) as unknown as Record<string, unknown>);
      }

      const schema = readFileSync(join(__dirname, '../src/schema.gql'), 'utf8');
      const typeMatch = schema.match(/type PromotionType \{([\s\S]*?)\n\}/);
      expect(typeMatch).not.toBeNull();
      const body = typeMatch![1];
      expect(body).not.toMatch(/\beligible\b/);
      expect(body).not.toMatch(/\bineligibilityReason\b/);
      expect(body).not.toMatch(/\bdiscountAmount\b/);
      expect(body).not.toMatch(/\bfreeUnits\b/);
    });
  });
});
