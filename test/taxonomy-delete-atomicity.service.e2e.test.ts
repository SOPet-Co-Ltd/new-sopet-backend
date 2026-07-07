// Category Taxonomy Delete Atomicity service-integration-e2e Test - Design Doc: category-taxonomy-image-delete-backend-design.md
// Implement target (mandated merge gate): test/taxonomy-delete-atomicity.e2e-spec.ts
// Generated: 2026-07-07 | Budget Used: integration 0/3, fixture-e2e 0/3, service-e2e 2/2
//
// AC1: "When admin deletes with valid replacement category R, the system shall set all bound products category_id to R.id, update legacy category name, delete original category, and return reassignedProductCount (AC-009)"
// ROI: 80 (BV:10 × Freq:7 + Legal:0 + Defect:10) — reserved slot (real DB transaction; fixture/mock cannot prove atomicity)
// Behavior: deleteCategory(categoryWithProducts, replacementId) → all bound products reassigned → source category row removed → DeleteCategoryResult reflects count
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL test DB, TaxonomyService, Product repository, Category repository
// @real-dependency: PostgreSQL, TypeORM transaction manager
// @complexity: high
// Primary failure mode: partial reassignment — some products retain deleted category_id, or category deleted while products still reference it; legacy products.category name not synced to replacement
// Proof obligation: seed category C with N non-soft-deleted products, approved replacement R; invoke deleteCategory(C, R) against real test database; assert COUNT(products WHERE category_id=C)=0, all N have category_id=R.id and legacy category column = R.name, categories row C absent, result.reassignedProductCount === N. S3 and StorageService may be mocked; DB transaction must be real
// Verification points / expected results / pass criteria:
// - All N products have category_id = replacement.id after commit
// - Legacy products.category string equals replacement.name for each reassigned row
// - Category C row deleted from categories table
// - Response success true, deletedCategoryId = C, reassignedProductCount = N, replacementCategoryId = R.id
// - Soft-deleted products excluded from reassignment count (if seeded)
//
// Sub-case (same reserved slot): "When deleteCategory transaction fails mid-flight, no partial reassignment persists (AC-009 reliability NFR — rollback case)"
// ROI: (included in reserved slot AC-009)
// Behavior: Simulated failure after product UPDATE but before category DELETE → transaction rolls back → all products still on C; category C still exists
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL test DB, TaxonomyService with spied/stubbed manager.delete(Category) throw
// @real-dependency: PostgreSQL, TypeORM transaction manager
// @complexity: high
// Primary failure mode: orphaned state after failed delete — products moved to R while C remains, or C deleted while products still reference C
// Proof obligation: seed C with N products and valid replacement R; stub manager.delete(Category) to throw after UPDATE succeeds inside transaction; invoke deleteCategory; assert exception propagated and post-state shows all N products still category_id=C, category C row exists. Traverses failure boundary on DELETE step after successful UPDATE
// Verification points / expected results / pass criteria:
// - deleteCategory throws (exception propagated to caller)
// - All N products still have category_id = C.id
// - Category C row still present
// - No products reference replacement id from partial commit
//
// AC2: "When admin opens tag delete flow, tagDeleteImpact shall return accurate productCount (AC-012); When admin confirms deleteTag, the system shall remove tag and all product_tags rows (AC-013)"
// ROI: 57 (BV:8 × Freq:6 + Legal:0 + Defect:9)
// Behavior: tagDeleteImpact returns join count → deleteTag removes tag row and CASCADE cleans product_tags → detachedProductCount matches pre-delete count
// @category: core-functionality
// @lane: service-integration-e2e
// @dependency: full-system — PostgreSQL test DB, TaxonomyService, Tag repository, product_tags join
// @real-dependency: PostgreSQL, product_tags CASCADE FK
// @complexity: medium
// Primary failure mode: tagDeleteImpact undercounts/overcounts; deleteTag leaves orphan product_tags rows or fails when M=0
// Proof obligation: seed tag T with M product_tags join rows (include M=0 and M>0 cases); assert tagDeleteImpact.productCount === M; after deleteTag assert tags row absent and COUNT(product_tags WHERE tag_id=T)=0; result.detachedProductCount === M. Real DB required to prove CASCADE behavior
// Verification points / expected results / pass criteria:
// - tagDeleteImpact.productCount equals actual join row count
// - deleteTag removes tag from tags table
// - Zero product_tags rows remain for deleted tag id
// - deleteTag succeeds when M=0 (AC-014 boundary within same proof suite)
