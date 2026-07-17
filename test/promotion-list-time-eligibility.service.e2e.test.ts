// Promotion List-Time Eligibility [service-integration-e2e] Test — Decision 6 delta
// Design Doc: promotion-universal-conditions-backend-design.md (§ Delta Decision 6)
// PRD: promotion-universal-conditions-prd.md (AC-048 apply authority; AC-041/046 server path)
// Generated: 2026-07-17 | Budget Used: integration 0/3, fixture-e2e 0/3, service-e2e 1/2
//
// Delta-named (not appended to promotion-universal-conditions.service.e2e.test.ts):
// Decision 5 reserved createOrder journey already occupies that file.
//
// Implement target: test/promotion-list-time-eligibility.e2e-spec.ts (PROMOTED — see that file)
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL, TypeORM (promotions, customers, orders, products,
// promotion_usages); GraphQL validatePromotions + createOrder path
// Mock: Omise / Redis / external payment (not on path); Storage N/A
//
// ---------------------------------------------------------------------------
// Reserved slot — batch soft-eligible then createOrder still authoritative (AC-048)
// ---------------------------------------------------------------------------
//
// AC-048: "When batch marks a promo eligible with a preview discountAmount, then
// createOrder/apply still enforces the same gates and may deny — batch never grants
// money apply would deny."
// AC-041 / AC-046 (cross-service half): batch soft outcomes for seeded promos must
// match persisted apply/deny behavior against real DB.
// ROI: 80 (BV:10 × Freq:7 + Legal:0 + Defect:10) — reserved slot (real DB persistence
// of order + PromotionUsage; fixture/mock cannot prove apply authority after batch)
// Behavior: Seed catalog + conditioned / min-purchase promos → validatePromotions
// against live API → createOrder with same codes/customer/lines → money/deny matches
// apply rules, not batch optimism
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PromotionsResolver.validatePromotions, OrdersService.create,
// PromotionsService.applyStackedPromotions, PostgreSQL test DB
// @real-dependency: PostgreSQL, TypeORM transaction / order create path
// @complexity: high
// Primary failure mode: createOrder accepts a code that batch marked eligible but
// apply gates deny (or vice versa soft codes diverge); batch treated as money grant;
// PromotionUsage written for a promo apply would have skipped/denied
// Proof obligation: Against real test DB — (1) returning customer fails new-customer
// gates: validatePromotions returns soft ORDER_HISTORY/ACCOUNT_AGE eligible=false;
// createOrder with that code hard-throws same family / no order row. (2) Soft-eligible
// unconditioned (or dual-gate-pass) promo: batch discountAmount equals createOrder
// persisted merchandise discount and promotion_usages.discount_amount. (3) Batch soft
// PROMOTION_MIN_PURCHASE eligible=false → createOrder with code still hard-denies min
// purchase (batch never unlocks apply). (4) Infrastructure: whole-query transport
// errors are out of scope here (storefront AC-051). Omise mocked or COD path only.
// Boundary: soft batch preview vs hard apply / createOrder; DB-persisted usage amounts
// Verification points / expected results / pass criteria:
// - Soft-ineligible batch item → createOrder deny / no orders row for that conditioned code
// - Soft-eligible batch item → createOrder discount_amount matches batch preview amount
// - promotion_usages.discount_amount equals stacked per-promo map (no re-derive)
// - Min-purchase soft in batch still hard on createOrder
// - No order created when guest + newCustomer-conditioned code applied
