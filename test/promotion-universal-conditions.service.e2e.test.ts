// Promotion Universal Conditions [service-integration-e2e] Test
// Design Doc: promotion-universal-conditions-backend-design.md
// PRD: promotion-universal-conditions-prd.md (FR-1, FR-3, FR-8; AC-003 create path, AC-035, AC-037)
// Generated: 2026-07-16 | Budget Used: integration 0/3, fixture-e2e 0/3, service-e2e 1/2
//
// Implement target: test/promotion-universal-conditions.e2e-spec.ts (PROMOTED — see that file)
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL, TypeORM (promotions, customers, orders, products, promotion_usages)
// Mock: Omise / Redis / external payment (not on path); Storage N/A
//
// ---------------------------------------------------------------------------
// Reserved slot — createOrder authoritative money path with dual gates + BxGy
// ---------------------------------------------------------------------------
//
// AC-003 (create path): "When createOrder applies a conditioned promo without customerId,
// then the system hard-throws (fail closed)."
// AC-035: "When the same customer, lines, and codes are evaluated via validatePromotion and
// createOrder stacking, then eligible discountAmount / freeUnits match."
// AC-037 / I001c: "BxGy lines present and freeUnits=0 → apply skips promo without aborting
// createOrder; never hard-throw solely for Rule A zero free."
// AC-021 / Rule B: "Free units discount-only; PromotionUsage.discountAmount from stacked
// per-promo map (not re-derived from type)."
// ROI: 95 (BV:10 × Freq:8 + Legal:0 + Defect:15) — reserved slot (real DB persistence of
// order totals + PromotionUsage; fixture/mock cannot prove createOrder authority)
// Behavior: Seed conditioned + BxGy promotions and cart lines against live test DB →
// createOrder → order merchandise discount and PromotionUsage rows persist correctly;
// guest hard-fail; insufficient BxGy qty does not abort order
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — OrdersService.create, PromotionsService.applyStackedPromotions,
// PostgreSQL test DB, seeded Customer / Product / Variant / Promotion
// @real-dependency: PostgreSQL, TypeORM transaction / order create path
// @complexity: high
// Primary failure mode: createOrder accepts guest conditioned promo; PromotionUsage.discountAmount
// re-derived ignoring BxGy stack map; INSUFFICIENT_QTY aborts entire createOrder; preview-eligible
// amounts diverge from persisted order discount on same seed
// Proof obligation: against real test DB — (1) createOrder as guest with newCustomer-conditioned
// code → throws GUEST and no order row; (2) eligible new customer + Buy2Get1 with Q=3 of P →
// order discount equals Rule B cheapest free unit sum and PromotionUsage.discountAmount matches
// discountsByPromotionId; (3) same customer/lines/codes via validatePromotion(preview) equals
// createOrder applied amounts; (4) BxGy with Q=2 (freeUnits=0) → createOrder succeeds without
// that promo discount and without throw. Omise/payment mocked or COD path only.
// Boundary: hard eligibility vs Rule A apply-skip; DB-persisted usage amounts
// Verification points / expected results / pass criteria:
// - Guest + conditioned code: no orders row; exception code GUEST
// - Eligible createOrder: order discount_amount (or equivalent) reflects stacked result
// - promotion_usages.discount_amount equals stacked per-promo map for BxGy and fixed_amount
// - validatePromotion soft eligible amounts match createOrder for identical fixtures
// - Q insufficient BxGy: order created; that promo contributes 0; no INSUFFICIENT_QTY throw
// - No free order_items / free markers inserted (ADR Decision 3)
