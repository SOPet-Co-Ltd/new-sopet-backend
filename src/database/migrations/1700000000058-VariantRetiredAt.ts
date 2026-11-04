import { MigrationInterface, QueryRunner } from 'typeorm';

export class VariantRetiredAt1700000000058 implements MigrationInterface {
  name = 'VariantRetiredAt1700000000058';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_variants"
        ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_variants_retired_at"
        ON "product_variants" ("retired_at")
        WHERE "retired_at" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_product_variants_retired_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "retired_at"
    `);
  }
}
