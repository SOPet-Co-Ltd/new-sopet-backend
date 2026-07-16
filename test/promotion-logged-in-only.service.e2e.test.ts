// Promotion Logged-In Only [service-integration-e2e] Test
// Design Doc: promotion-logged-in-only-backend-design.md
// PRD: promotion-logged-in-only-prd.md (FR-1, FR-5; AC-005 create path, AC-006, AC-021)
// Parent pattern: test/promotion-universal-conditions.service.e2e.test.ts
// Generated: 2026-07-16 | Budget Used: integration 0/3, fixture-e2e 0/3, service-e2e 1/2
//
// Implement target: test/promotion-logged-in-only.e2e-spec.ts (promote when executable)
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL, TypeORM (promotions, customers, orders, products, promotion_usages)
// Mock: Omise / Redis / external payment (not on path); Storage N/A
//
// ---------------------------------------------------------------------------
// Reserved slot — createOrder authoritative money path with loggedInOnly gate
// ---------------------------------------------------------------------------
//
// AC-005 (create path): "When createOrder / apply mode evaluates a guest against a
// loggedInOnly.enabled === true promotion, then the system hard-throws GUEST and the
// promotion does not discount."
// AC-006: "When a logged-in returning customer evaluates only-loggedInOnly (not newCustomer)
// and other rules pass, then the customer may be eligible."
// AC-021: "Auto-apply and manual apply paths both enforce the same guest ineligibility via
// shared validateCode."
// ROI: 90 (BV:10 × Freq:8 + Legal:0 + Defect:10) — reserved slot (real DB persistence of
// order totals / absence of order row; fixture/mock cannot prove createOrder authority)
// Behavior: Seed loggedInOnly-conditioned promotion against live test DB → createOrder as
// guest hard-fails with GUEST and no order row; createOrder as returning authenticated
// customer with only loggedInOnly applies discount and persists PromotionUsage
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — OrdersService.create, PromotionsService.applyStackedPromotions,
// PostgreSQL test DB, seeded Customer / Product / Variant / Promotion
// @real-dependency: PostgreSQL, TypeORM transaction / order create path
// @complexity: high
// Primary failure mode: createOrder accepts guest + loggedInOnly promo (discount leak);
// returning member incorrectly blocked by newCustomer dual gates; order row created despite GUEST
// Proof obligation: against real test DB — (1) createOrder as guest with
// loggedInOnly:{enabled:true} code → throws GUEST and no orders row; (2) createOrder as
// returning customerId (prior paid-path and/or old account) with only loggedInOnly → order
// discount reflects type math and promotion_usages row persists; (3) guestPhone-only identity
// does not satisfy the gate. Omise/payment mocked or COD path only. Fixture-e2e cannot prove
// fail-closed persistence.
// Boundary: hard eligibility on createOrder; DB-persisted usage amounts vs no order on GUEST
// Verification points / expected results / pass criteria:
// - Guest + loggedInOnly code: no orders row; exception code GUEST
// - Returning member + only loggedInOnly: order created; discount_amount > 0 when other rules pass
// - promotion_usages.discount_amount matches stacked per-promo map for eligible path
// - guestPhone-only createOrder with loggedInOnly code: GUEST; no discount
