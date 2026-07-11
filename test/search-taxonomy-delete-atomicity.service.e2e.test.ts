// Search & Taxonomy Fixes — Category Delete Atomicity [service-integration-e2e] Test
// Design Doc: search-taxonomy-fixes-design.md
// PRD: search-taxonomy-fixes-prd.md (Bundle B2, B3)
// Generated: 2026-07-11 | Budget Used: integration 0/3, fixture-e2e 0/3, service-e2e 2/2
//
// Implement target: test/search-taxonomy-delete-atomicity.e2e-spec.ts
// (Supersedes comment obligations in test/taxonomy-delete-atomicity.service.e2e.test.ts for
// AC-012–AC-017; prior file retained for backward traceability until promoted.)
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL, TypeORM transaction manager
// Mock: StorageService, BullMQ embedding enqueue (post-commit only; must not affect transaction)
//
// ---------------------------------------------------------------------------
// AC-012: "`deleteCategory` input (`DeleteTaxonomyInput`) shall accept optional
// `replacementCategoryId` when the category has bound non-soft-deleted products."
// AC-013: "On successful delete with replacement, all non-soft-deleted products with
// `category_id = deletedId` shall be updated to `replacementCategoryId` and legacy `category`
// synced to replacement name."
// AC-005: "When products are assigned or reassigned to categories, the legacy `product.category`
// string column shall stay in sync with the resolved category name."
// AC-014: "Delete reassignment shall be atomic; partial updates shall not persist on failure."
// AC-015: "Response shall include `reassignedProductCount`, `deletedCategoryId`, and
// `replacementCategoryId`."
// ROI: 96 (BV:10 × Freq:7 + Legal:0 + Defect:10) — reserved slot (real DB transaction;
// fixture/mock cannot prove atomicity or legacy column sync)
// Behavior: deleteCategory(categoryWithProducts, replacementId) → all bound non-soft-deleted
// products reassigned → legacy category string synced → source category row removed →
// DeleteTaxonomyResult reflects counts and ids
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL test DB, TaxonomyService, Product repository, Category repository
// @real-dependency: PostgreSQL, TypeORM transaction manager
// @complexity: high
// Primary failure mode: partial reassignment — some products retain deleted category_id, legacy
// products.category not synced to replacement.name, or category deleted while products still
// reference it; response missing deletedCategoryId alias
// Proof obligation: seed category C with N non-soft-deleted products (include 1 soft-deleted on C
// excluded from N), approved replacement R; invoke deleteCategory(C, R) against real test DB;
// assert COUNT(products WHERE category_id=C AND deleted_at IS NULL)=0; all N have
// category_id=R.id AND legacy category column = R.name; soft-deleted row on C unchanged;
// categories row C absent; result.reassignedProductCount === N, deletedCategoryId === C.id,
// replacementCategoryId === R.id, deletedId === deletedCategoryId. S3/StorageService mocked
// Verification points / expected results / pass criteria:
// - All N non-soft-deleted products have category_id = R.id after commit
// - Legacy products.category string equals R.name for each reassigned row
// - Soft-deleted product on C not reassigned and not counted
// - Category C row deleted from categories table
// - Response success true, reassignedProductCount = N, deletedCategoryId = C.id, replacementCategoryId = R.id
//
// ---------------------------------------------------------------------------
// Sub-case (same reserved slot): AC-014 rollback — transaction failure mid-flight
// ROI: (included in reserved slot AC-014)
// Behavior: simulated failure after product UPDATE but before category DELETE → transaction rolls
// back → all products still on C; category C still exists
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL, TaxonomyService with stubbed manager.delete(Category) throw
// @real-dependency: PostgreSQL, TypeORM transaction manager
// @complexity: high
// Primary failure mode: orphaned state after failed delete — products moved to R while C remains,
// or C deleted while products still reference C
// Proof obligation: seed C with N products and valid R; stub manager.delete(Category) to throw
// after UPDATE inside transaction; invoke deleteCategory; assert exception propagated and
// post-state shows all N products still category_id=C, category C row exists, no products on R.
// Traverses failure boundary on DELETE step after successful UPDATE
// Verification points / expected results / pass criteria:
// - deleteCategory throws (exception propagated)
// - All N products still have category_id = C.id and legacy category unchanged
// - Category C row still present
// - No products reference R.id from partial commit
//
// ---------------------------------------------------------------------------
// AC-016: "`categoryDeleteImpact` shall return non-soft-deleted product count and up to 10 product
// names from the same filtered set."
// AC-017: "When deleting a category with zero bound non-soft-deleted products,
// `replacementCategoryId` shall not be required."
// ROI: 58 (BV:8 × Freq:6 + Legal:0 + Defect:8)
// Behavior: categoryDeleteImpact excludes soft-deleted products from count/names; deleteCategory
// with productCount=0 succeeds without replacementCategoryId; category row removed
// @category: edge-case
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL, TaxonomyService
// @real-dependency: PostgreSQL
// @complexity: medium
// Primary failure mode: impact preview counts soft-deleted rows (mismatch with delete behavior);
// empty category delete rejects without replacement or requires spurious replacementCategoryId
// Proof obligation: seed category E with 0 active products (optionally 1 soft-deleted); assert
// categoryDeleteImpact.productCount=0 and names=[]; deleteCategory(E) without replacement succeeds;
// seed category F with 12 active products; assert impact returns count=12 and ≤10 names with
// overflow semantics; soft-deleted product on F excluded from count. Boundary: zero-product
// delete path (AC-017) vs impact soft-delete filter (AC-016)
// Verification points / expected results / pass criteria:
// - categoryDeleteImpact productCount matches only deleted_at IS NULL rows
// - Impact name preview capped at 10 from same filtered set as count
// - deleteCategory without replacement succeeds when productCount=0
// - Category row removed; reassignedProductCount=0 in response
