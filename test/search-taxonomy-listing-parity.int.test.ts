// Search & Taxonomy Fixes — Listing Parity [integration] Test - Design Doc: search-taxonomy-fixes-design.md
// PRD: search-taxonomy-fixes-prd.md (Bundle A)
// Generated: 2026-07-11 | Budget Used: integration 1/3, fixture-e2e 0/3, service-e2e 0/2
//
// Implement target: test/search-taxonomy-listing-parity.e2e-spec.ts
// (Comment-only skeleton per repo convention; promote to `.e2e-spec.ts` picked up by
// `test/jest-e2e.json` once implemented.)
//
// Harness template: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST,
// seeded PostgreSQL test database (products, categories, stores with mixed approval statuses).
//
// Test Boundaries compliance (Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (products, categories, stores — join and FK filter behavior)
// Mock: EmbeddingService, BullMQ queue producers, Redis (when not on critical path)
//
// ---------------------------------------------------------------------------
// AC-001: "When a client queries `products` without Smart Search active, the system shall
// return only `PUBLISHED` products whose store `status = approved`."
// ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
// Behavior: client calls `products(status: PUBLISHED)` on legacy path (no `search` param,
// SEARCH_SMART_ENABLED off or empty search) → response excludes products from suspended or
// pending stores even when product.status is PUBLISHED
// @category: core-functionality
// @lane: integration
// @dependency: ProductsService, ProductsResolver, PostgreSQL (seeded stores + products)
// @real-dependency: PostgreSQL
// @complexity: high
// Primary failure mode: legacy `applyProductListFilters` omits approved-store join — suspended-store
// product ids leak into public listing results
// Proof obligation: seed product A (PUBLISHED, approved store), product B (PUBLISHED, suspended
// store), product C (DRAFT, approved store); execute `products` without search; assert result id
// set contains only A and never B or C. Mock boundary: only external I/O mocked; listing path
// uses real DB joins
// Verification points / expected results / pass criteria:
// - Response items include only PUBLISHED products from stores with status = approved
// - Suspended-store PUBLISHED product absent from items and total count
// - DRAFT product absent regardless of store status
// - Fail if any non-approved-store product id appears in response
//
// ---------------------------------------------------------------------------
// AC-002: "Legacy listing store-visibility rules shall match Smart Search rules verified in
// `smart-search.int.test.ts` (AC-023 reference)."
// ROI: (included in AC-001 proof suite — set equality comparison)
// Behavior: identical DB seed → legacy `products` id set equals Smart Search `products(search: ...)`
// public listing id set for same filter inputs (category, petType, brand, price, tag)
// @category: integration
// @lane: integration
// @dependency: ProductsService, SearchService, SearchRepository, PostgreSQL
// @real-dependency: PostgreSQL
// @complexity: high
// Primary failure mode: legacy path and Smart Search path diverge on store visibility — one path
// filters approved stores and the other does not
// Proof obligation: with SEARCH_SMART_ENABLED=true, run legacy `products` (no search) and
// `products(search: "seeded-query")` against same seed; assert set(product.id) from legacy ⊆ set
// from smart search public listing for overlapping filters; specifically assert suspended-store
// product absent from both. Traverses parity boundary between legacy and Smart Search branches
// Verification points / expected results / pass criteria:
// - Legacy listing product ids are subset of (or equal to) Smart Search public listing ids for same seed
// - No id present in legacy but absent from Smart Search due to store-status filter gap
// - Suspended-store product absent from both paths
//
// ---------------------------------------------------------------------------
// AC-003: "When `products(category: String)` receives a category name or slug, the system shall
// resolve it to `category_id` and filter on the FK internally."
// AC-004: (contract guard) public GraphQL `products` query retains `category: String` — no
// `categoryId` public argument exposed in schema introspection for this query
// ROI: 95 (BV:10 × Freq:8 + Legal:0 + Defect:9) — FK resolution sub-case
// Behavior: seed product with category_id pointing to approved category C (slug `dog-food`) but
// stale legacy `product.category` string ≠ C.name; query `products(category: "dog-food")` returns
// product by FK; query with unresolvable slug returns empty items without error
// @category: core-functionality
// @lane: integration
// @dependency: ProductsService, TaxonomyService.resolveApprovedCategoryFilter, PostgreSQL
// @real-dependency: PostgreSQL
// @complexity: high
// Primary failure mode: filter still matches legacy `product.category` string column — stale string
// causes wrong inclusion/exclusion; unresolvable slug returns unfiltered products instead of empty set
// Proof obligation: seed approved category C (slug + name), product P with category_id=C.id and
// legacy category column intentionally stale; execute products(category: C.slug) and assert P in
// results; execute products(category: "nonexistent-slug") and assert items=[] total=0; introspect
// products query args and assert categoryId arg absent (AC-004). Boundary: slug resolution vs stale
// legacy string drift
// Verification points / expected results / pass criteria:
// - FK-linked product returned when filtering by slug despite stale legacy category string
// - Unresolvable category string yields empty listing (items=[], total=0)
// - Public schema exposes `category: String` only (no public categoryId on products query)
// - Resolution runs before Smart Search branch when search param also present (shared pre-step)
//
// Harness (task-01): import from `test/helpers` when promoting to `.e2e-spec.ts`.
//   createSearchTaxonomyGraphqlE2eHarness(), seedListingParityDataset(), cleanupSeedRun()
import type { ListingParitySeedDataset } from './helpers/seed-factories';

export type SearchTaxonomyListingParityHarnessSeed = ListingParitySeedDataset;
