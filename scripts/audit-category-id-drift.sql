-- Pre-release category_id / legacy string drift audit
-- Design Doc: search-taxonomy-fixes-design.md (§ Migration / Data — Pre-release data audit)
-- Run against staging/production before deploy:
--   psql "$DATABASE_URL" -f scripts/audit-category-id-drift.sql

\echo '=== 1. category_id set but legacy category string mismatches joined categories.name ==='
SELECT COUNT(*) AS drift_count
FROM products p
INNER JOIN categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
  AND p.category IS DISTINCT FROM c.name;

\echo '=== 2. category_id NULL but legacy category string is set ==='
SELECT COUNT(*) AS orphan_legacy_string_count
FROM products p
WHERE p.deleted_at IS NULL
  AND p.category_id IS NULL
  AND p.category IS NOT NULL
  AND BTRIM(p.category) <> '';

\echo '=== 3. orphaned category_id referencing missing or rejected categories ==='
SELECT COUNT(*) AS orphaned_fk_count
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
  AND p.category_id IS NOT NULL
  AND (
    c.id IS NULL
    OR c.approval_status <> 'approved'
  );

\echo '=== Sample rows (first 20) for each non-zero bucket ==='
SELECT 'drift' AS bucket, p.id, p.category_id, p.category AS legacy_category, c.name AS category_name
FROM products p
INNER JOIN categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
  AND p.category IS DISTINCT FROM c.name
ORDER BY p.updated_at DESC
LIMIT 20;

SELECT 'legacy_without_fk' AS bucket, p.id, p.category
FROM products p
WHERE p.deleted_at IS NULL
  AND p.category_id IS NULL
  AND p.category IS NOT NULL
  AND BTRIM(p.category) <> ''
ORDER BY p.updated_at DESC
LIMIT 20;

SELECT 'orphaned_fk' AS bucket, p.id, p.category_id, c.approval_status
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.deleted_at IS NULL
  AND p.category_id IS NOT NULL
  AND (
    c.id IS NULL
    OR c.approval_status <> 'approved'
  )
ORDER BY p.updated_at DESC
LIMIT 20;
