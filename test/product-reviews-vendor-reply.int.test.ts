// Product Reviews Vendor Reply [integration] Test Skeleton - Design Doc: product-reviews-vendor-reply-backend-design.md
// UI Spec: product-reviews-vendor-reply-ui-spec.md | Frontend Design Doc: product-reviews-vendor-reply-frontend-design.md
// Generated: 2026-07-10 | Budget Used (feature): integration 3/3, fixture-e2e n/a (backend), service-e2e 1/2 (see product-reviews-vendor-reply.service.e2e.test.ts)
//
// Implement target: test/product-reviews-vendor-reply.e2e-spec.ts
// (Promote comment-only skeleton to `.e2e-spec.ts` under `test/jest-e2e.json`, mirroring
// test/product-sold-count-batching.int.test.ts → test/product-sold-count-batching.e2e-spec.ts.)
//
// Covers:
//   src/modules/reviews/reviews.service.ts (createReviewReply, updateReviewReply, findByStore, create, resolveInitialReviewStatus)
//   src/modules/reviews/reviews.resolver.ts (storeReviews, productReviews, mutations)
//   src/database/entities/review-reply.entity.ts
//
// Harness: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST; seeded PostgreSQL
// test database with reviews, review_replies, products (store-scoped), product_images.
//
// Test Boundaries compliance (Backend Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (reviews, review_replies, products, product_images)
// Mock: StoresService.userHasStoreAccess only when isolating auth unit paths — prefer real store membership seed for integration
//
// Skipped ACs (covered elsewhere):
//   AC-011 cross-store forbidden → service-e2e reserved slot (real auth + no insert proof)
//   AC-002 productImageUrl mapping → storefront/admin RTL; thumbnail resolver covered in service unit tests
//   AC-015 regression error codes → existing reviews.service.spec.ts paths
//
// ---------------------------------------------------------------------------
// AC-018: "WHEN `storeReviews(storeId)` is called publicly, THEN the system shall return
// approved reviews for that store with productName, productImageUrl, rating, comment,
// customerName, createdAt, and nested `reply`"
// AC-019: "WHEN a store has no approved reviews and `storeReviews` is queried, THEN the
// system shall return an empty array"
// AC-009 (read path): "WHEN any review is queried via `storeReviews`, THEN the system shall
// return at most one nested `reply` object or `null`"
// ROI: 80 (BV:8 × Freq:8 + Legal:0 + Defect:8)
// Behavior: unauthenticated GraphQL `storeReviews(storeId: <storeA>)` returns only approved
// reviews whose product belongs to storeA, ordered by createdAt DESC, each with nullable
// nested reply; querying storeB with no approved reviews returns `[]` (not an error).
// @category: core-functionality
// @lane: integration
// @dependency: real GraphQLModule + ReviewsResolver + ReviewsService, real PostgreSQL test DB (multi-store seed)
// @complexity: high
// Primary failure mode: findByStore in-memory filter regression — wrong store rows leak in, or
// replies from other stores appear; empty store returns error instead of `[]`.
// Proof obligation: seed storeA with 2 approved reviews (one with reply, one without) and
// storeB with 1 approved review; call public `storeReviews` for each store without JWT;
// assert storeA returns exactly 2 rows with correct product fields and at most one reply each;
// assert storeB returns 1 row; call `storeReviews` for storeC (no reviews) and assert `[]`.
// Boundary path: store with zero approved reviews must hit empty-array branch, not 404.
// Verification points / expected results / pass criteria:
//   - Public query succeeds without Authorization header.
//   - Row count and review ids match store-scoped seed only.
//   - Nested `reply` present only when reply row exists; never more than one per review.
//   - Empty store returns `[]`.
//   - Fail if cross-store review ids appear or non-approved reviews leak.
//
// ---------------------------------------------------------------------------
// AC-005: "WHEN a vendor with store access submits `createReviewReply` for a review with no
// existing reply and valid body (1–1000 chars), THEN the system shall persist one
// `review_replies` row linked to that `review_id` and return `ReviewReplyType`"
// AC-006: "WHEN a vendor submits `createReviewReply` for a review that already has a reply,
// THEN the system shall reject with code `REVIEW_REPLY_ALREADY_EXISTS` and not insert a
// second row"
// AC-007: "WHEN a vendor with store access submits `updateReviewReply` with valid `replyId`
// and body, THEN the system shall update the same row, change `updated_at`, and return the
// new body"
// ROI: 75 (BV:8 × Freq:7 + Legal:0 + Defect:9)
// Behavior: vendor JWT calls `createReviewReply` → row inserted → second create on same
// review returns `REVIEW_REPLY_ALREADY_EXISTS` with no extra row; `updateReviewReply` mutates
// same `replyId`, bumps `updatedAt`, returns new body.
// @category: core-functionality
// @lane: integration
// @dependency: ReviewsService + ReviewReply repository (in-process GraphQL or service-level with test DB), vendor JWT fixture, StoresService access true for owning store
// @complexity: high
// Primary failure mode: duplicate reply allowed (unique constraint not enforced), update creates
// new row instead of editing, or wrong error code on duplicate create.
// Proof obligation: arrange approved review without reply; create with body "ขอบคุณครับ";
// assert GraphQL returns reply id + body; query DB count `review_replies` for review_id = 1;
// second create must fail with extensions code `REVIEW_REPLY_ALREADY_EXISTS` and count stays 1;
// update with new body asserts same id, changed body, `updatedAt` > `createdAt`.
// Boundary path: duplicate create after successful first create (AC-006 branch).
// Verification points / expected results / pass criteria:
//   - First create persists exactly one row and returns ReviewReplyType.
//   - Duplicate create: HTTP/GraphQL error code REVIEW_REPLY_ALREADY_EXISTS; row count unchanged.
//   - Update changes body on same id; updatedAt advances.
//   - Fail if two rows exist for one review_id or update inserts new row.
//
// ---------------------------------------------------------------------------
// AC-016: "WHEN `createReview` succeeds in any environment including `REVIEW_AUTO_APPROVE=false`,
// THEN the persisted review `status` shall be `approved`"
// AC-017: "WHEN `createReview` succeeds, THEN `syncProductReviewStats` shall run"
// User focus journey #4: createReview always approved
// ROI: 64 (BV:8 × Freq:7 + Legal:0 + Defect:8)
// Behavior: with `REVIEW_AUTO_APPROVE=false` in env, customer `createReview` mutation persists
// review with `status: approved` and product review stats reflect the new approved review
// (averageRating/reviewCount updated observable via product or stats query).
// @category: core-functionality
// @lane: integration
// @dependency: ReviewsService.create, resolveInitialReviewStatus, syncProductReviewStats, test DB or spied product stats updater
// @complexity: medium
// Primary failure mode: env flag still yields `pending` status; stats sync skipped so new review
// invisible on PDP until manual approval.
// Proof obligation: set REVIEW_AUTO_APPROVE=false; execute valid createReview; assert persisted
// entity status APPROVED; assert syncProductReviewStats invoked or product.reviewCount increments
// relative to pre-create baseline; public `productReviews` includes new review without moderation step.
// Boundary path: REVIEW_AUTO_APPROVE=false must not change outcome post-REQ-6.
// Verification points / expected results / pass criteria:
//   - Created review status is `approved` regardless of env.
//   - Product review stats updated (count or spy on syncProductReviewStats).
//   - New review appears in public productReviews query.
//   - Fail if status pending or stats unchanged.
