// soldCount DataLoader Batching [integration] Test Skeleton - Design Doc: performance-optimization-backend-design.md
// Generated: 2026-07-09 | Budget Used (Backend feature): integration 2/3 (this file), fixture-e2e n/a, service-e2e n/a
//
// Implement target: test/product-sold-count-batching.e2e-spec.ts
// (Naming follows the repo's own convention: this file starts as a
// comment-only `.int.test.ts` skeleton and is renamed/promoted to
// `.e2e-spec.ts` -- picked up by `test/jest-e2e.json` -- once implemented,
// per the pattern already established by
// test/category-taxonomy-image-delete.int.test.ts /
// test/taxonomy-delete-atomicity.service.e2e.test.ts.)
//
// Covers (all "New" per Design Doc "Existing Codebase Analysis" --
// none of these files exist yet):
//   src/graphql/loaders/graphql-context.factory.ts   (per-request loader registry)
//   src/graphql/loaders/graphql-loaders.module.ts     (DI wiring, imports AnalyticsModule)
//   src/graphql/loaders/product-sold-count.loader.ts  (DataLoader batch fn)
// Modified:
//   src/graphql/graphql.module.ts (forRootAsync + context factory, currently
//     `context: ({ req, res }) => ({ req, res })` only)
//   src/modules/products/products.resolver.ts (soldCount @ResolveField,
//     currently `this.analyticsService.getProductSoldCount(product.id)`
//     per-product)
//   src/modules/analytics/analytics.service.ts (new
//     `getProductSoldCounts(productIds: string[])` batched sibling to the
//     existing single-id `getProductSoldCount`)
//
// Harness template: mirror test/app.e2e-spec.ts's pattern (Nest
// `TestingModule` + real `GraphQLModule.forRoot({ driver: ApolloDriver,
// autoSchemaFile: true, context: ... })` + `supertest` POSTing a GraphQL
// query string), registering the real `ProductsResolver` +
// `GraphqlLoadersModule`/context factory, so that a `products { items { id
// soldCount } }` query actually triggers N parallel `@ResolveField`
// invocations in one GraphQL execution tick -- a prerequisite for
// DataLoader batching to have anything to coalesce. A plain resolver unit
// test calling `resolver.soldCount(parent, ctx)` directly cannot exercise
// this batching window.
//
// Test Boundaries compliance (per Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (order_items, orders, product_variants, products)
// The Design Doc explicitly marks PostgreSQL as "No" for mocking in this
// AC-019 integration test ("Call-count requires real query logging or spy
// on repository"; "Mock limitations: Unit mocks cannot prove N->1 call
// count - integration test required"). This diverges from every existing
// `test/*.e2e-spec.ts` in this repo (which all use `getRepositoryToken`
// mocks, per test/app.e2e-spec.ts and test/store-suspension.e2e-spec.ts) --
// that divergence is intentional and required by this specific AC, not an
// oversight. Connect to a real (test) Postgres instance seeded with a
// known product/order_items/orders/product_variants fixture set, and
// enable TypeORM query logging (or an equivalent query-interceptor) scoped
// to the analytics repository so the test can assert the actual number of
// SQL round-trips, not just a mocked method's call count.
//
// ---------------------------------------------------------------------------
// AC-019: "WHEN a `products` list query of size N selects `soldCount`,
// THE SYSTEM SHALL perform exactly one aggregated sold-count data fetch,
// not N per-product calls" (PRD BE-2; Backend Design Doc "BE-2 soldCount
// Batching")
// ROI: 89 (BV:8 x Freq:10 + Legal:0 + Defect:9)
// Behavior: a `products(limit: N)` query selecting `soldCount` on every
// item triggers N `ProductsResolver.soldCount` field resolutions in one
// GraphQL execution tick; each calls `context.loaders.productSoldCount.load(id)`;
// DataLoader coalesces the N loads into one call to
// `AnalyticsService.getProductSoldCounts(ids[])`, which issues exactly one
// SQL query (`GROUP BY product.id`) against the seeded test database --
// not N sequential single-product queries.
// @category: core-functionality
// @lane: integration
// @dependency: real GraphQLModule + ProductsResolver + GraphqlLoadersModule/context factory (in-process), real PostgreSQL test database (seeded fixture), AnalyticsService.getProductSoldCounts (real, backed by the real DB)
// @complexity: high
// Primary failure mode: the per-request loader is wired but the resolver
// still calls the old single-id `getProductSoldCount` (migration
// incomplete), or the DataLoader instance is constructed once at module
// scope instead of per-request inside `GraphqlContextFactory.create()`
// (risking cross-request bleed even if it happens to batch within one
// request) -- either way, a list of N products issues N (or otherwise
// more than 1) sold-count queries instead of exactly 1.
// Proof obligation: seed the test database with N products (N >= 3) each
// having a distinct, known count of non-cancelled/non-refunded
// `order_items`, execute `{ products(limit: N) { items { id soldCount } } }`
// via `supertest`/`app.getHttpServer()` against the real GraphQL app, and
// assert (a) the query-logging/interceptor records exactly one SQL query
// against the sold-count aggregation path (not N), and (b) each returned
// `soldCount` value exactly matches that product's seeded expected count,
// in the correct product-to-count correspondence (proving the batched
// result isn't just coalesced but also correctly ordered/keyed).
// Verification points / expected results / pass criteria:
//   - Exactly one SQL query executes for the sold-count aggregation
//     across the whole N-product response (not N, not N+1).
//   - Each product's `soldCount` in the response exactly matches its
//     seeded expected value, correctly correspondent to that product's id
//     (not shifted/misaligned across the batch).
//   - Concurrent second request in the same test (simulating overlapping
//     requests) does not share loader/cache state with the first --
//     confirms the loader is constructed per-request, not per-module
//     (Design Doc Risk: "DataLoader shared across requests").
//   - Fail if more than one SQL query is observed for the aggregation, if
//     any product's count is wrong/misaligned, or if two concurrent
//     requests' loaders visibly share cached state.
//
// ---------------------------------------------------------------------------
// AC-019 (boundary path): soldCount correctness is preserved for a
// product with zero matching order_items after batching (implicit
// contract of BE-2's "Same GraphQL response bodies for equivalent
// queries" correctness proof method; DataLoader batch fn "missing IDs -> 0"
// contract per Design Doc "soldCount Batch Query Design")
// ROI: 36 (BV:5 x Freq:6 + Legal:0 + Defect:6)
// Behavior: when the seeded product list includes at least one product
// with zero non-cancelled/non-refunded order_items, that product's
// `soldCount` resolves to `0` (not `null`/undefined/an error), and its
// presence does not change the call count from the AC-019 happy-path test
// (still exactly one aggregated query for the whole list) -- this is the
// distinct branch the aggregation's `COALESCE(SUM(...), 0)` +
// DataLoader's "missing key -> 0" fallback must both traverse correctly;
// the happy-path test alone (all products with nonzero sales) would stay
// green even if this fallback path were broken.
// @category: edge-case
// @lane: integration
// @dependency: same as above (real GraphQLModule + real seeded PostgreSQL test database, one product with zero order_items)
// @complexity: medium
// Primary failure mode: the aggregation SQL's `GROUP BY product.id` omits
// rows for products with zero matching `order_items` (an `INNER JOIN`
// naturally excludes them), and the DataLoader batch function's mapping
// back to the original per-product `soldCount` array assumes every input
// id appears in the aggregated result set -- causing either an `undefined`/
// crash for the zero-sales product, or (if a naive array-index mapping is
// used instead of an id-keyed lookup) a misaligned value borrowed from a
// neighboring product.
// Proof obligation: seed a products list where at least one product has
// zero non-cancelled/non-refunded order_items, execute the same list query
// as the happy-path test, and assert that specific product's `soldCount`
// is exactly `0` (not null/undefined/error), every other product's count
// is still correct and correctly keyed, and the call count remains exactly
// one aggregated query for the whole list (proving the zero-sales product
// didn't trigger a separate fallback query).
// Verification points / expected results / pass criteria:
//   - The zero-sales product's `soldCount` resolves to `0`.
//   - All other products' counts remain correct and correctly keyed to
//     their own id.
//   - Exactly one aggregated SQL query still executes for the whole list
//     (the zero-sales product does not trigger an extra query).
//   - Fail if the zero-sales product's field throws/resolves to null, if
//     any count is misaligned across products, or if an extra query is
//     observed.
