// Smart Search [integration] Test Skeleton - Design Doc: smart-search-backend-design.md
// PRD: smart-search-prd.md | UI Spec: smart-search-ui-spec.md
// Generated: 2026-07-10 | Budget Used (Smart Search feature): integration 2/3 (this file), fixture-e2e n/a (storefront), service-e2e 1/2 (see smart-search.service.e2e.test.ts)
//
// Implement target: test/smart-search.e2e-spec.ts
// Promoted AC-006 (search-taxonomy-fixes backend-task-03): test/smart-search.e2e-spec.ts
// (Comment-only skeleton per repo convention; promote to `.e2e-spec.ts` picked up by
// `test/jest-e2e.json` once implemented, mirroring
// test/product-sold-count-batching.int.test.ts → test/product-sold-count-batching.e2e-spec.ts.)
//
// Covers (new):
//   src/modules/search/search.module.ts
//   src/modules/search/search.service.ts
//   src/modules/search/search.repository.ts
//   src/modules/search/ranking.engine.ts
//   src/modules/search/search-synonym.service.ts
//   src/modules/search/search-suggestions.service.ts
// Modified:
//   src/modules/products/products.service.ts (delegate search branch when SEARCH_SMART_ENABLED)
//   src/modules/products/products.resolver.ts (optional sessionId, searchContext args)
//
// Harness template: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST,
// seeded PostgreSQL test database with extensions `pg_trgm` (+ `vector` when semantic leg enabled),
// `'thai'` tsconfig verified. Register real SearchModule wiring — not repository mocks.
//
// Test Boundaries compliance (Design Doc "Mock Boundary Decisions"):
// @real-dependency: PostgreSQL (products, stores, search_synonyms, search_vector GIN, pg_trgm)
// Mock: Redis (unit/isolated paths only — integration may use real Redis or accept DB fallback),
//       Embedding API, BullMQ queue producers
//
// Skipped ACs (budget / lane): AC-021 personalization reorder-only → RankingEngine unit tests;
// AC-022 p95 latency → load testing [IMPLEMENTATION_DETAIL]; AC-037 SSR stability → storefront fixture-e2e.
//
// ---------------------------------------------------------------------------
// AC-003: "WHEN `products(search: ...)` executes with a Thai query, THE SYSTEM SHALL
// match via `search_vector @@ plainto_tsquery('thai', ...)` rather than bare ILIKE
// as the primary matcher"
// AC-004: "WHEN `ProductsService.findAll` receives a `search` parameter with Smart Search
// enabled, THE SYSTEM SHALL use the `search_vector` GIN index in the query plan"
// AC-005: "WHEN search combines with `petTypeIds`, `brandIds`, `minPrice`, `maxPrice`,
// `tag`, or `category`, THE SYSTEM SHALL apply filters conjunctively with FTS match"
// AC-023 (search path): published products from approved stores only on public search
// AC-023 (suggestions path): same store/status filter on `searchSuggestions` responses
// AC-022 (observable subset): partial query ≥2 returns product name + query completion payloads
// User decision: text-only suggestions — response must omit thumbnail URLs
// ROI: 109 (BV:10 × Freq:10 + Legal:0 + Defect:9)
// Behavior: client calls `products(search: "อาหารแมว", ...)` with `SEARCH_SMART_ENABLED=true`;
// response returns only published products from approved stores, ranked by Smart Search
// relevance; conjunctive filters narrow the set without breaking filter semantics; query plan
// uses GIN index on `search_vector` (not ILIKE scan). Same seed set: `searchSuggestions(query:
// "อา", limit: 10)` returns only published/approved-store products with `{ id, name, slug }`
// only (no thumbnailUrl); draft-store product name prefix must not appear in suggestions.
// @category: core-functionality
// @lane: integration
// @dependency: real GraphQLModule + SearchModule + ProductsResolver (in-process), real PostgreSQL test DB (seeded Thai/English catalog, mixed store statuses), SEARCH_SMART_ENABLED flag on
// @complexity: high
// Primary failure mode: live path still uses ILIKE (`products.service.ts` search branch not
// delegated), approved-store JOIN missing (draft/suspended store products leak), or filters
// applied as disjunction/OR so faceted search regresses.
// Proof obligation: seed ≥3 products — (a) Thai name match published+approved, (b) Thai match
// but non-approved store, (c) published+approved but different petType; execute
// `products(search: "อาหารแมว", sortBy: relevance)` and assert only (a) returns; enable
// TypeORM/query logging or `EXPLAIN` wrapper and assert `Bitmap Index Scan` on
// `idx_products_search_vector` (or equivalent GIN usage) with no `%ILIKE%` primary filter;
// repeat with `petTypeIds: [catId]` and assert intersection count ⊆ unfiltered count and
// every item satisfies both FTS and petType filter.
// Verification points / expected results / pass criteria:
//   - Top results include seeded Thai-match published product from approved store.
//   - Non-approved store product absent even if name matches query.
//   - `petTypeIds` (and one of brand/price/tag/category) conjunctively reduces set; no
//     filter-only product appears without FTS match.
//   - Query plan evidence shows GIN/`search_vector` usage when smart flag on.
//   - `searchSuggestions` excludes non-approved-store product; payload has no thumbnailUrl.
//   - Fail if ILIKE-only plan, store filter gap, filter conjunction breaks, or suggestions leak draft products.
//
// ---------------------------------------------------------------------------
// AC-006: "IF FTS returns fewer than `trigramFallbackThreshold` results (default 5),
// THEN THE SYSTEM SHALL supplement with `pg_trgm` similarity on product name"
// AC-007: "WHEN trigram similarity is below configured minimum, THE SYSTEM SHALL exclude
// the candidate"
// AC-009: "WHEN a shopper query matches a synonym term case-insensitively, THE SYSTEM SHALL
// expand tokens before FTS/trigram evaluation"
// ROI: 80 (BV:9 × Freq:8 + Legal:0 + Defect:8)
// Behavior: (trigram path) query typo "royal caniin" with FTS leg returning <5 hits still
// returns Royal Canin product via trigram leg above `trigramMinSimilarity`; (synonym path)
// active synonym `{ terms: ["royal"], expansion: "Royal Canin" }` causes search for "royal"
// to include products matching expanded tokens; candidate below `trigramMinSimilarity` excluded.
// @category: integration
// @lane: integration
// @dependency: real PostgreSQL (search_synonyms seeded, pg_trgm index), SearchSynonymService (real DB read; Redis mock acceptable), SearchRepository trigram leg
// @complexity: high
// Primary failure mode: trigram leg never invoked when FTS sparse, synonym expansion skipped
// so colloquial terms miss, or trigram returns sub-threshold noise (AC-007 violation).
// Proof obligation: seed Royal Canin product + synonym row; execute search with intentional
// typo and with synonym term separately; assert expected product id present in results;
// execute query with similarity-below-minimum decoy name and assert excluded (AC-007 boundary).
// Verification points / expected results / pass criteria:
//   - Typo query returns Royal Canin when FTS alone would return < threshold.
//   - Synonym term query returns products matching expansion tokens not literal query token.
//   - Candidate below `trigramMinSimilarity` excluded.
//   - Fail if typo/synonym paths do not change result membership as specified.
//
// ---------------------------------------------------------------------------
// Search & Taxonomy Fixes extension — Design Doc: search-taxonomy-fixes-design.md
// Budget (Search Taxonomy feature): integration 3/3 (this block), fixture-e2e n/a, service-e2e n/a
//
// AC-006: "When Smart Search is active and `tag` filter is provided, the semantic search leg shall
// apply the tag constraint conjunctively with other filters."
// ROI: 72 (BV:9 × Freq:7 + Legal:0 + Defect:9)
// Behavior: client calls `products(search: "อาหารแมว", tag: "grain-free-tag")` with Smart Search
// enabled → semantic leg candidates exclude products without tag association; lexical+semantic RRF
// result set respects tag same as lexical-only path
// @category: core-functionality
// @lane: integration
// @dependency: SearchRepository.fetchSemanticLegIds, SearchService, ProductsService pre-resolution, PostgreSQL (product_tags, tags)
// @real-dependency: PostgreSQL
// @complexity: high
// Primary failure mode: semantic leg omits tag EXISTS clause — tag-filtered Smart Search returns
// semantically similar products lacking the selected tag
// Proof obligation: seed products P1 (matches search + has tag T), P2 (matches search semantically
// but no tag T), P3 (has tag T but weak search match); execute products(search, tag: T.slug) with
// SEARCH_SMART_ENABLED=true; assert P1 in results, P2 absent, P3 only if search relevance
// threshold met; compare with tag omitted — P2 may appear. Boundary: semantic leg tag filter
// conjunctive with category/petType filters when combined
// Verification points / expected results / pass criteria:
// - Product without tag association excluded from tag-filtered Smart Search results
// - Product with tag association included when search relevance qualifies
// - Tag filter applied in semantic leg SQL (not lexical leg only)
// - Combined tag + category filter uses pre-resolved categoryId in both legs
// - Fail if semantic-only candidate leaks without tag when tag param set
