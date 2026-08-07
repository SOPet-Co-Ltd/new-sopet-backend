import { MigrationInterface, QueryRunner } from 'typeorm';

export class VariantCompareAtPrice1700000000044 implements MigrationInterface {
  name = 'VariantCompareAtPrice1700000000044';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_variants"
        ADD COLUMN IF NOT EXISTS "compare_at_price" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "compare_at_price"
    `);
  }
}
