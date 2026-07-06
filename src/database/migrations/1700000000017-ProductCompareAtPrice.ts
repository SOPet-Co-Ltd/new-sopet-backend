import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductCompareAtPrice1700000000017 implements MigrationInterface {
  name = 'ProductCompareAtPrice1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "compare_at_price" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN IF EXISTS "compare_at_price"
    `);
  }
}
