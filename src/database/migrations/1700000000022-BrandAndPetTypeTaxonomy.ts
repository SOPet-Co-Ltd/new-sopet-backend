import { MigrationInterface, QueryRunner } from 'typeorm';

export class BrandAndPetTypeTaxonomy1700000000022 implements MigrationInterface {
  name = 'BrandAndPetTypeTaxonomy1700000000022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "pet_types" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "approval_status" "taxonomy_approval_status_enum" NOT NULL DEFAULT 'pending',
        "image_url" varchar(500),
        "created_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_pet_types_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_pet_types_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_pet_types_approval_status"
        ON "pet_types" ("approval_status")
    `);

    await queryRunner.query(`
      CREATE TABLE "brands" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "approval_status" "taxonomy_approval_status_enum" NOT NULL DEFAULT 'pending',
        "created_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_brands_created_by"
          FOREIGN KEY ("created_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_brands_slug" UNIQUE ("slug")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_brands_approval_status"
        ON "brands" ("approval_status")
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "pet_type_id" uuid,
        ADD CONSTRAINT "fk_products_pet_type"
          FOREIGN KEY ("pet_type_id") REFERENCES "pet_types"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "brand_id" uuid,
        ADD CONSTRAINT "fk_products_brand"
          FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_pet_types_name_lower"
        ON "pet_types" (LOWER("name"))
        WHERE "approval_status" <> 'rejected'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_brands_name_lower"
        ON "brands" (LOWER("name"))
        WHERE "approval_status" <> 'rejected'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_brands_name_lower"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_pet_types_name_lower"`);

    await queryRunner.query(`
      ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "fk_products_brand"
    `);
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "brand_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "fk_products_pet_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "pet_type_id"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "brands" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pet_types" CASCADE`);
  }
}
