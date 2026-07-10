// Smart Search [service-integration-e2e] Test Skeleton - Design Doc: smart-search-backend-design.md
// PRD: smart-search-prd.md
// Generated: 2026-07-10 | Budget Used (Smart Search feature): integration 2/3 (backend) + 1/3 (storefront), fixture-e2e 3/3 (storefront), service-e2e 2/2 (this file)
//
// Implement target: test/smart-search.service.e2e-spec.ts
// (Promote skeleton to `.e2e-spec.ts` under `test/jest-e2e.json` with real local Postgres +
// optional Redis stack — not MSW/fixture GraphQL.)
//
// Reserved slot: user-facing search journey whose correctness requires real DB persistence
// (analytics event row) that fixture-level tests cannot prove.
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL (search_events, products, stores, search_vector, search_synonyms)
// @real-dependency: SearchAnalyticsService async writer (real insert, not mocked repository)
// Mock: Embedding API, external embedding provider HTTP
//
// User decision: Postgres-native Smart Search full MVP — real hybrid retrieval + live synonym
// cache round-trip verified here (not mocked repository).
//
// ---------------------------------------------------------------------------
// AC-028: "WHEN any search or suggestion request executes, THE SYSTEM SHALL record an
// analytics event asynchronously with `{ query, resultCount, latencyMs, filters, sessionId,
// userId?, suggestionClicked?, timestamp }`"
// AC-029: "WHEN `resultCount = 0`, THE SYSTEM SHALL flag the event for zero-result reporting"
// ROI: 78 (BV:8 × Freq:8 + Legal:0 + Defect:6) — RESERVED service-integration-e2e slot
// Behavior: client executes public GraphQL `products(search: "ไม่มีสินค้า", sessionId: <uuid>)`
// against running local stack; HTTP response returns promptly with `resultCount=0`; within
// bounded async window a row appears in `search_events` with matching query, session_id,
// `is_zero_result=true`, and non-null latency_ms — proving fire-and-forget analytics does
// not block response yet persists.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (local Nest app + real Postgres), GraphQL products query, search_events table
// @complexity: high
// Primary failure mode: analytics call awaited on hot path (latency regression), events
// dropped silently, or zero-result flag not set so admin dashboard skews.
// Proof obligation: issue search returning zero hits with known sessionId; assert GraphQL
// response time does not include synchronous analytics insert; poll/await `search_events`
// for row matching query + session_id + `is_zero_result=true`; repeat with nonzero search
// and assert `is_zero_result=false`. Analytics failure must not fail search response (log-and-continue).
// Verification points / expected results / pass criteria:
//   - Search GraphQL succeeds even if analytics writer errors (simulate optional).
//   - Zero-result query creates flagged analytics row with expected fields.
//   - Nonzero-result query creates row with `is_zero_result=false`.
//   - Fail if response blocked on analytics or events missing in DB.
//
// ---------------------------------------------------------------------------
// AC-008: "WHEN an admin saves a synonym, THE SYSTEM SHALL make it available to query
// expansion within 60 seconds (cache TTL configurable)"
// AC-009 (live effect): synonym term changes shopper search results after save
// AC-010 (boundary): deactivated synonym excluded after cache expiry
// ROI: 72 (BV:8 × Freq:7 + Legal:0 + Defect:8) — additional service-e2e (ROI > 50)
// Behavior: admin GraphQL `createSearchSynonym` (authenticated) persists row; within cache
// TTL a subsequent public `products(search: "<term>")` result set reflects expansion (product
// visible that literal query would not match without synonym); after `isActive=false` and
// cache expiry, expansion no longer applies.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (admin JWT + public search), PostgreSQL search_synonyms, Redis cache (real or TTL simulation)
// @complexity: high
// Primary failure mode: synonym saved to DB but expansion cache stale indefinitely, or
// admin mutation succeeds without affecting public search path.
// Proof obligation: create synonym via admin mutation; execute public search for synonym
// term; assert expanded-match product present; deactivate synonym; advance cache TTL/wait;
// assert result set reverts; boundary: inactive synonym must not expand (AC-010).
// Verification points / expected results / pass criteria:
//   - Post-save search includes synonym-expanded matches within TTL.
//   - Deactivated synonym stops affecting results after cache expiry.
//   - Non-admin cannot mutate synonyms (AC-012 spot-check optional in same suite).
//   - Fail if DB row exists but live search unchanged.
