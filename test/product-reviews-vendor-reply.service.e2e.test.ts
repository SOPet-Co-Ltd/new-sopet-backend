// Product Reviews Vendor Reply [service-integration-e2e] Test Skeleton - Design Doc: product-reviews-vendor-reply-backend-design.md
// UI Spec: product-reviews-vendor-reply-ui-spec.md | Frontend Design Doc: product-reviews-vendor-reply-frontend-design.md
// Generated: 2026-07-10 | Budget Used (feature): integration 3/3 (see product-reviews-vendor-reply.int.test.ts), fixture-e2e n/a (backend), service-e2e 1/2 (this file)
//
// Implement target: test/product-reviews-vendor-reply.service.e2e-spec.ts
// (Promote to `.e2e-spec.ts` under `test/jest-e2e.json` with running local Nest app + real Postgres.)
//
// RESERVED service-integration-e2e slot: vendor reply write must persist across real DB write and
// be observable on separate public read queries — fixture/mock repos cannot prove FK, unique
// constraint, and cross-query read consistency.
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL (reviews, review_replies, products, stores)
// @real-dependency: ReviewsService createReviewReply + findByProduct + findByStore (no repository mocks)
// Mock: external HTTP only (none for this feature)
//
// User focus journeys covered:
//   #1 Vendor creates reply (mutation persists)
//   #2 Customer sees reply on PDP (productReviews nested reply)
//   #3 Customer sees reply on seller tab (storeReviews nested reply)
//
// ---------------------------------------------------------------------------
// AC-005: "WHEN a vendor with store access submits `createReviewReply` ... THEN the system
// shall persist one `review_replies` row"
// AC-012: "WHEN `productReviews(productId)` is called publicly, THEN each approved review shall
// include nested `reply` when a reply exists"
// AC-013: "WHEN review has no reply, nested reply is null/absent"
// AC-010: "Replies returned on public reads without pending state"
// AC-018 (reply on seller list): storeReviews includes nested reply when present
// ROI: 95 (BV:10 × Freq:8 + Legal:0 + Defect:9) — RESERVED service-integration-e2e slot
// Behavior: vendor-authenticated `createReviewReply` for seeded approved review → within same
// test stack unauthenticated `productReviews(productId)` and `storeReviews(storeId)` both return
// the parent review with matching nested `reply.body`; review without vendor reply still has
// `reply: null`.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (local Nest + real Postgres), vendor JWT, public GraphQL reads
// @complexity: high
// Primary failure mode: reply saved but public read queries omit join (stale resolver mapping) or
// reply visible before parent review approved; cross-query inconsistency between PDP and seller tab.
// Proof obligation: seed product with 2 approved reviews (A with no reply, B with no reply);
// vendor creates reply on B only; poll/query `productReviews` — B has reply, A has null;
// `storeReviews` for product's store lists B with same reply id/body; direct SQL count confirms
// single review_replies row. No Authorization on public queries.
// Boundary path: read immediately after write in same DB transaction scope (immediate consistency).
// Verification points / expected results / pass criteria:
//   - createReviewReply returns 200 with reply id.
//   - productReviews includes nested reply on correct review only.
//   - storeReviews includes same nested reply for same review id.
//   - Unreplied review still has null reply on both queries.
//   - Fail if reply missing on either public surface or duplicate rows in DB.
//
// ---------------------------------------------------------------------------
// AC-011: "WHEN vendor User A attempts `createReviewReply` or `updateReviewReply` for a review
// whose product belongs to Store B, THEN the system shall respond with ForbiddenException code
// `STORE_ACCESS_DENIED` or NotFoundException code `REVIEW_NOT_FOUND` and persist nothing"
// ROI: 55 (BV:7 × Freq:5 + Legal:0 + Defect:9) — additional service-e2e (ROI > 50 threshold)
// Behavior: vendor JWT for storeA attempts createReviewReply on review belonging to storeB;
// GraphQL error with STORE_ACCESS_DENIED (or REVIEW_NOT_FOUND per design); `review_replies` row
// count for that review_id remains 0; legitimate storeA vendor can still reply on storeA review.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system, two vendor users / store memberships seeded, real Postgres
// @complexity: medium
// Primary failure mode: cross-store reply persisted (authorization bypass) or wrong store vendor
// blocked from own reviews.
// Proof obligation: attempt cross-store create; assert error code and zero DB rows; then create
// on own-store review succeeds (proves auth not globally broken).
// Boundary path: forbidden cross-store branch must not insert even when review exists.
// Verification points / expected results / pass criteria:
//   - Cross-store mutation fails with expected error code.
//   - No review_replies row inserted for target review.
//   - Same vendor succeeds on in-store review.
//   - Fail if row inserted on forbidden attempt.
