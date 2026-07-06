import { MigrationInterface, QueryRunner } from 'typeorm';

export class TaxonomyNameUnique1700000000011 implements MigrationInterface {
  name = 'TaxonomyNameUnique1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Resolve pre-existing case-insensitive name collisions among non-rejected
    // rows before enforcing uniqueness. Keep the oldest row (by created_at, then
    // id) untouched and append a "-2", "-3", ... suffix to the name/slug of the
    // newer duplicates so the partial unique index can be created.
    await this.dedupeByLowerName(queryRunner, 'categories');
    await this.dedupeByLowerName(queryRunner, 'tags');

    // Case-insensitive uniqueness for category/tag names, ignoring rejected proposals.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_categories_name_lower" ON "categories" (LOWER("name")) WHERE "approval_status" <> 'rejected'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_tags_name_lower" ON "tags" (LOWER("name")) WHERE "approval_status" <> 'rejected'`,
    );
  }

  private async dedupeByLowerName(
    queryRunner: QueryRunner,
    table: 'categories' | 'tags',
  ): Promise<void> {
    await queryRunner.query(
      `WITH ranked AS (
         SELECT id,
                ROW_NUMBER() OVER (
                  PARTITION BY LOWER("name")
                  ORDER BY "created_at" ASC, "id" ASC
                ) AS rn
         FROM "${table}"
         WHERE "approval_status" <> 'rejected'
       )
       UPDATE "${table}" t
       SET "name" = t."name" || '-' || r.rn,
           "slug" = t."slug" || '-' || r.rn
       FROM ranked r
       WHERE t."id" = r.id AND r.rn > 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_tags_name_lower"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_categories_name_lower"`);
  }
}
