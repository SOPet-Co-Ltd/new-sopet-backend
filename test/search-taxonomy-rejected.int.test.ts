// Search & Taxonomy Fixes — Rejected Taxonomy [integration] Test - Design Doc: search-taxonomy-fixes-design.md
// PRD: search-taxonomy-fixes-prd.md (Bundle A6)
// Generated: 2026-07-11 | Budget Used: integration 2/3, fixture-e2e 0/3, service-e2e 0/2
//
// Implement target: test/search-taxonomy-rejected.e2e-spec.ts
//
// Harness template: Nest TestingModule + real GraphQLModule + supertest; admin-authenticated
// request context (`@Roles('admin')`); seeded PostgreSQL with mixed approval_status rows.
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL (categories, tags tables)
// Mock: StorageService, EmbeddingService (not on query path)
//
// ---------------------------------------------------------------------------
// AC-009: "GraphQL shall expose `rejectedCategories` and `rejectedTags` returning items with
// `approvalStatus = rejected`, ordered consistently with pending list resolvers."
// ROI: 55 (BV:7 × Freq:5 + Legal:0 + Defect:8)
// Behavior: admin client queries `rejectedCategories` and `rejectedTags` → only rejected items
// returned; pending and approved items excluded; category ordering matches `findPendingCategories`
// (name ASC); tag ordering matches pending tags (createdAt DESC)
// @category: core-functionality
// @lane: integration
// @dependency: TaxonomyResolver, TaxonomyService, PostgreSQL (seeded taxonomy rows)
// @real-dependency: PostgreSQL
// @complexity: medium
// Primary failure mode: resolvers missing or return pending/approved items mixed in; ordering
// diverges from pending list conventions — admin rejected tabs show wrong data
// Proof obligation: seed categories {approved A, pending P, rejected R1, rejected R2} and tags
// {approved, pending, rejected T1, rejected T2} with distinct names/timestamps; execute both
// queries as ADMIN; assert only rejected ids returned; assert category order name ASC; assert tag
// order createdAt DESC matches pending tag resolver pattern. Boundary: status filter excludes
// non-rejected rows
// Verification points / expected results / pass criteria:
// - rejectedCategories contains only approvalStatus=rejected items
// - rejectedTags contains only approvalStatus=rejected items
// - No pending or approved taxonomy id appears in either response
// - Category list ordered name ASC; tag list ordered createdAt DESC (consistent with pending resolvers)
// - Non-admin caller receives authorization error (existing AuthGuard behavior)
//
// Harness (task-01): import from `test/helpers` when promoting to `.e2e-spec.ts`.
//   createSearchTaxonomyGraphqlE2eHarness(), seedRejectedTaxonomyDataset(), cleanupSeedRun()
import type { RejectedTaxonomySeedDataset } from './helpers/seed-factories';

export type SearchTaxonomyRejectedHarnessSeed = RejectedTaxonomySeedDataset;
