import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Listing indexes for published products, reviews, and public order sort.
 * Customer trigram indexes use pg_trgm, created in 1700000000024 and already
 * used by 1700000000026. They are skipped when the extension is missing.
 */
export class PerformanceListIndexes1700000000059 implements MigrationInterface {
  name = 'PerformanceListIndexes1700000000059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_published_category_created"
        ON "products" ("category_id", "created_at" DESC)
        WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_published_pet_type_created"
        ON "products" ("pet_type_id", "created_at" DESC)
        WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_published_brand_created"
        ON "products" ("brand_id", "created_at" DESC)
        WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_published_created"
        ON "products" ("created_at" DESC)
        WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_reviews_product_status_created"
        ON "reviews" ("product_id", "status", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_updated_created_id"
        ON "orders" ("updated_at" DESC, "created_at" DESC, "id")
    `);

    const extensions = (await queryRunner.query(
      `SELECT 1 AS present FROM pg_extension WHERE extname = 'pg_trgm'`,
    )) as Array<{ present: number }>;
    if (extensions.length === 0) {
      return;
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customers_phone_trgm"
        ON "customers" USING gin ("phone" gin_trgm_ops)
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customers_full_name_trgm"
        ON "customers" USING gin ("full_name" gin_trgm_ops)
        WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customers_email_trgm"
        ON "customers" USING gin ("email" gin_trgm_ops)
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customers_email_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customers_full_name_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customers_phone_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_updated_created_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_reviews_product_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_published_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_published_brand_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_published_pet_type_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_published_category_created"`);
  }
}
