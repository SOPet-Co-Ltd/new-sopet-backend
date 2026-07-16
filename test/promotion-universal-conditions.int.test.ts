// Promotion Universal Conditions integration Test
// Design Doc: promotion-universal-conditions-backend-design.md
// PRD: promotion-universal-conditions-prd.md (FR-1, FR-2, FR-3, FR-8)
// Generated: 2026-07-16 | Budget Used: integration 3/3, fixture-e2e 0/3, service-e2e 0/2
//
// Implement target: expand PromotionsService coverage (this file or promotions.service.spec.ts
// colocated helpers). Keep skeletons comment-only until implementation task adds executable
// imports / describe / assertions.
//
// Unit Red scaffolds (Phase 0 / backend-task-01): promotions.service.spec.ts
//   describe('case-1: ...') | describe('case-2: ...') | describe('case-3: ...')
//   align to integration cases 1–3 below; executable green deferred to backend-task-02..07.
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Promotion / Usage / Customer / Order / Product repositories
// @real-dependency: none (in-process service + mocked repos)
//
// ---------------------------------------------------------------------------
// Integration test 1 of 3 — New-customer dual gates (soft preview vs hard apply)
// Unit scaffold: describe('case-1: new-customer dual gates (AC-003–012)')
// ---------------------------------------------------------------------------
//
// AC-003: "Given a guest session and a promotion with the new-registered-customer condition,
// when cart/checkout evaluates promotions, then that promotion does not apply."
// AC-005 / AC-009 / AC-012: "Logged-in customer with no paid-path orders and age ≤ N×24h UTC
// may be eligible when other rules pass."
// AC-006: "Customer with ≥1 paid-path order → conditioned promo does not apply."
// AC-007: "Orders only outside paid-path set → order-history gate still passes."
// AC-010: "Evaluation after createdAt + N×24h → ACCOUNT_AGE reject."
// AC-011: "Fail either gate → promotion does not apply (AND)."
// ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
// Behavior: validateCode(mode=preview|apply) with newCustomer.enabled → GUEST / ORDER_HISTORY /
// ACCOUNT_AGE soft reasons (preview) or hard throws (apply); both gates must pass for eligible
// @category: core-functionality
// @lane: integration
// @dependency: PromotionsService, Customer repository (mock), Order repository (mock), Promotion repository (mock)
// @complexity: high
// Primary failure mode: guest or paid-path / age-failed customer still receives discountAmount>0;
// preview hard-throws eligibility instead of soft reason; apply soft-skips instead of hard throw;
// gates OR instead of AND
// Proof obligation: fixture conditioned percentage promo; (A) no customerId → preview
// discountAmount=0 + ineligibilityReason=GUEST, apply throws GUEST; (B) customer with PAID order →
// ORDER_HISTORY soft/hard; (C) only cancelled/pending orders → history gate passes; (D) createdAt
// older than N×24h → ACCOUNT_AGE; (E) both gates pass → discount applies; (F) fail either alone →
// no apply. Mock Customer/Order repos only; use real PromotionsService gate helpers. Boundary:
// preview vs apply mode for each eligibility class
// Verification points / expected results / pass criteria:
// - Preview guest: discountAmount=0, freeUnits=0, ineligibilityReason='GUEST'
// - Apply guest: BadRequestException response.code === 'GUEST'
// - Preview ORDER_HISTORY / ACCOUNT_AGE: soft reason codes; discountAmount=0
// - Apply same inputs: hard throw with matching code
// - Non-paid-path-only history does not set ORDER_HISTORY
// - Age window inclusive of end instant (createdAt + N×24h)
// - Either-gate failure never yields positive discountAmount
//
// ---------------------------------------------------------------------------
// Integration test 2 of 3 — BxGy Rules A/B + MISSING_LINES vs INSUFFICIENT_QTY
// Unit scaffold: describe('case-2: BxGy Rules A/B + MISSING_LINES vs INSUFFICIENT_QTY …')
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
