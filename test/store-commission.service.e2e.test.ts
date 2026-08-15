// Store Commission [service-integration-e2e] Test Skeleton
// Design Doc: store-commission-backend-design.md (v1.3)
// Frontend Design Doc: store-commission-frontend-design.md (v1.2)
// UI Spec: store-commission-ui-spec.md (v1.1 Approved)
// PRD: store-commission-prd.md (AC-001–AC-028)
// Generated: 2026-08-16 | Budget Used (backend Design Doc): integration 3/3 (see store-commission.int.test.ts), fixture-e2e n/a (backend), service-e2e 2/2 (this file)
//
// Implement target: test/store-commission.service.e2e-spec.ts
// (Promote to `.e2e-spec.ts` under `test/jest-e2e.json` with running local Nest app + real Postgres.)
//
// RESERVED service-integration-e2e slot: payout-create snapshot and mixed-cutoff amounts must
// persist across a real DB write and remain unchanged after a later admin rate mutation.
// Fixture/mock repositories cannot prove same-transaction snapshot insert, nullable historical
// columns, or rail-independent persistence of amount === derived net.
//
// Test Boundaries compliance (Backend Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (stores, payouts, orders, order_items, order_store_shippings)
// @real-dependency: PayoutsService createOmisePayout + requestManualPayout + getPayoutSummary (no repository mocks)
// @real-dependency: StoresService.updateAsAdmin (no repository mocks)
// @real-dependency: payout-commission.calculator (pure)
// Mock: Omise HTTP only (createTransfer satang = Math.round(netAmount * 100); no new Omise API)
// Mock: Redis / BullMQ scheduler
// Storefront: N/A — AC-009 / AC-027 not executed here (no sopet-storefront tests)
//
// Preconditions (Phase 0 helper — do not execute SVC-1/SVC-2 here):
//   test/helpers/store-commission-e2e.seed.ts
//   - applyStoreCommissionE2eEnv() — COMMISSION_GO_LIVE_AT (non-secret ISO instant) +
//     commission.defaultRatePercent = 7; fills JWT/Omise test keys only when unset
//   - seedStoreCommissionE2eDataset() — stores, mixed-cutoff orders (paid_at), order_items,
//     order_store_shippings, store-scoped promotions, historical NULL-snapshot payout, hold fixture
//   - createStoreCommissionAuthFixture() / dataset.auth — admin JWT + vendor JWT
//   - stubOmiseCreateTransferHttp() — POST /transfers satang; no live Omise
//   - storeCommissionSchedulerMockProviders — Redis/BullMQ scheduler mocked
//   Cleanup: cleanupStoreCommissionE2eSeed(). Do not register this file in jest-e2e.json yet.
//
// Implementation pattern lock: PayoutsService / StoresService classes; calculator functions.
// Do not introduce a CommissionService.
//
// User-facing multi-step API journey (reserved):
//   #1 Admin leaves default 7% (NULL rate) or saves a custom rate
//   #2 Vendor / admin creates a payout on Omise and on the manual rail
//   #3 Snapshot fours + already-net amount persist
//   #4 Admin later edits the store rate
//   #5 Pending row stays frozen; leftover available-balance uses the current rate
//
// ---------------------------------------------------------------------------
// SVC-1 (RESERVED service-integration-e2e slot)
// AC-007: "When an Omise-rail payout is created, then commission is applied at that create using
// the effective rate on post-cutoff product only; amount and netAmount equal the computed net; fee is 0."
// AC-008: "When a manual-rail payout is created, then the same product / cutoff / shipping /
// rounding rules as the Omise rail apply."
// AC-017: "When a payout is created, then amount (and netAmount) equal the snapshotted net so
// /admin/manual-payouts binding amount is already-net."
// AC-018: "When payout create succeeds, then commission_rate, product_sold, shipping_fees,
// commission_amount are persisted in the same transaction as the insert."
// AC-019: "When a pending payout exists and admin later changes the store rate, then that payout’s
// snapshot columns and amount do not change."
// AC-021 / AC-022 / AC-023: post-cutoff commissioned + shipping; pre-cutoff 0% and shipping
// excluded; one combined fours (no pre/post pair columns).
// AC-028: leftover unpaid post after a rate change uses the current effective rate.
// ROI: 120 (BV:10 × Freq:10 + Legal:true×10 + Defect:10) — RESERVED (real DB write + later
// mutation must not rewrite the snapshot; fixture-e2e cannot prove persistence)
// Behavior: Running Nest + real Postgres: mixed unpaid set → create Omise payout (omit amount) →
// create manual payout on a second store/rail-equivalent set → SQL row has fours + amount ===
// derived net → updateStoreAsAdmin to a new rate → first payout row unchanged → getPayoutSummary
// leftover uses the new rate.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (local Nest + real Postgres), admin JWT, vendor JWT, Omise HTTP stub
// @complexity: high
// @real-dependency: PostgreSQL
// @real-dependency: PayoutsService
// @real-dependency: StoresService.updateAsAdmin
// Primary failure mode: snapshot columns written after commit (or omitted), pending amount moves
// after a rate edit, Omise vs manual persist different nets for the same unpaid set, or amount
// stored as pre-commission product.
// Proof obligation: assert via SQL (not only GraphQL) that the inserted payout row has
// commission_rate, product_sold, shipping_fees, commission_amount, amount, net_amount, fee=0 in
// one row; re-read the same primary key after updateStoreAsAdmin and assert identical snapshot
// columns; second rail insert matches calculator output for its unpaid set. Mock only Omise HTTP.
// Boundary path: mixed-cutoff unpaid set plus post-create rate change (immutability). A
// post-cutoff-only create would stay green if cutoff or snapshot-update code regresses.
// Verification points / expected results / pass criteria:
//   - SQL: new payout row has all four snapshot columns NOT NULL; amount === product_sold −
//     commission_amount + shipping_fees; net_amount === amount; fee === 0.
//   - Mixed fixture: pre product at 0%; post product at effective rate; shipping post-only;
//     no pre_/post_ columns on payouts.
//   - Omise stub called with Math.round(amount * 100); manual rail has no Omise call and same
//     identity for an equivalent unpaid set.
//   - After updateStoreAsAdmin(10): pending row snapshot + amount unchanged; availableBalance
//     on remaining unpaid post uses 10 (may diverge from lifetime_net − SUM(amount)).
//   - Historical NULL-snapshot payout (if seeded) remains NULL and is not backfilled.
//   - Fail if snapshot missing, amount === product_sold, or pending row recomputed.
//
// describe('store commission — payout snapshot persistence [service-integration-e2e]', () => {
//   it('persists combined fours and already-net amount on both rails and keeps a pending snapshot frozen after a later rate edit', () => {
//     // Arrange: seedStoreCommissionE2eDataset() (mixed-cutoff unpaid + historical NULL-snapshot);
//     //          applyStoreCommissionE2eEnv(); stubOmiseCreateTransferHttp(); admin/vendor JWT from dataset.auth
//     // Act: GraphQL/service create Omise (omit amount) + manual create; then updateStoreAsAdmin(10)
//     // Assert: SQL snapshot identity; pending unchanged; leftover available-balance at 10
//   });
// });
//
// ---------------------------------------------------------------------------
// SVC-2 (additional service-e2e — ROI 60 > 50 threshold)
// AC-025: "While an item is on_hold (or the order is on_hold), then that portion is excluded from
// item product and that store’s shipping is excluded unless another non-held eligible line remains."
// AC-026: "When held items leave hold, then they re-enter eligibility under this PRD’s cutoff and
// commission rules."
// ROI: 60 (BV:10 × Freq:5 + Legal:false×10 + Defect:10)
// Behavior: Against real Postgres hold SQL + order_store_shippings join, a held-only post-cutoff
// store/order contributes 0 product and 0 shipping to create/summary; after a real leave-hold
// update, the same order re-enters under cutoff + current rate.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system, real Postgres hold columns + shipping rows
// @complexity: medium
// @real-dependency: PostgreSQL
// @real-dependency: PayoutsService
// Primary failure mode: TypeORM hold/shipping joins accept held lines or held-only shipping once
// shipping is added to net — a regression mock QueryBuilders in payouts.service.spec.ts would miss.
// Proof obligation: seed real on_hold item + order_store_shippings row; create/summary over the
// live queries; assert SQL-backed zeros; flip hold off in DB; recompute and assert post-cutoff
// product + shipping + commission appear. Distinct from INT-3 (in-process) because this asserts
// the real schema/join, not the service’s mocked WHERE.
// Boundary path: held-only shipping exclusion (shipping requires ≥1 non-held eligible line).
// Selection exception: none — additional slot allowed (ROI 60 > 50); not consolidable into SVC-1
// without obscuring the hold-join proof obligation (SVC-1 proves snapshot durability, not hold SQL).
// Verification points / expected results / pass criteria:
//   - Held-only post-cutoff order: productSold / shippingFees / commissionAmount exclude that order.
//   - After leave-hold: same order’s store shipping appears in full; product commissioned at
//     current effective rate when paid_at >= goLiveAt.
//   - Existing store-suspension hold tests remain green (no item-hold join added to promo SUM).
//   - Fail if held shipping is paid out or held product is commissioned.
//
// describe('store commission — hold exclusion against real eligibility SQL [service-integration-e2e]', () => {
//   it('keeps on_hold portions and held-only shipping out of persisted payout totals until leave-hold', () => {
//     // Arrange: seedStoreCommissionE2eDataset().hold (on_hold item + order_store_shippings, post-cutoff)
//     // Act: getPayoutSummary / create; then clear hold; recompute
//     // Assert: zeros while held; cutoff-aware re-entry after restore
//   });
// });
