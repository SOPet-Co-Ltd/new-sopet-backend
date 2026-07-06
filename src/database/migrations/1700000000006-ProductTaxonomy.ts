import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductTaxonomy1700000000006 implements MigrationInterface {
  name = 'ProductTaxonomy1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "taxonomy_approval_status_enum" AS ENUM(
        'pending',
        'approved',
        'rejected'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "approval_status" "taxonomy_approval_status_enum" NOT NULL DEFAULT 'pending',
        "created_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_categories_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_categories_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_categories_approval_status"
        ON "categories" ("approval_status")
    `);

    await queryRunner.query(`
      CREATE TABLE "tags" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "approval_status" "taxonomy_approval_status_enum" NOT NULL DEFAULT 'pending',
        "created_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_tags_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_tags_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_tags_approval_status"
        ON "tags" ("approval_status")
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "category_id" uuid,
        ADD CONSTRAINT "fk_products_category"
          FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "product_tags" (
        "product_id" uuid NOT NULL,
        "tag_id" uuid NOT NULL,
        PRIMARY KEY ("product_id", "tag_id"),
        CONSTRAINT "fk_product_tags_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_product_tags_tag"
          FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_product_tags_tag_id"
        ON "product_tags" ("tag_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "product_tags" CASCADE`);

    await queryRunner.query(`
      ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "fk_products_category"
    `);

    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "category_id"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "tags" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "categories" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "taxonomy_approval_status_enum"`);
  }
}
