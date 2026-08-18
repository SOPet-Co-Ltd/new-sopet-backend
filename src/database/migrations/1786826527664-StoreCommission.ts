import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreCommission1786826527664 implements MigrationInterface {
  name = 'StoreCommission1786826527664';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
        ADD COLUMN IF NOT EXISTS "commission_rate" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD COLUMN IF NOT EXISTS "commission_rate" integer,
        ADD COLUMN IF NOT EXISTS "product_sold" numeric(10,2),
        ADD COLUMN IF NOT EXISTS "shipping_fees" numeric(10,2),
        ADD COLUMN IF NOT EXISTS "commission_amount" numeric(10,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payouts"
        DROP COLUMN IF EXISTS "commission_amount",
        DROP COLUMN IF EXISTS "shipping_fees",
        DROP COLUMN IF EXISTS "product_sold",
        DROP COLUMN IF EXISTS "commission_rate"
    `);
    await queryRunner.query(`
      ALTER TABLE "stores" DROP COLUMN IF EXISTS "commission_rate"
    `);
  }
}
