import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderItemSaleCampaignSnapshot1700000000048 implements MigrationInterface {
  name = 'OrderItemSaleCampaignSnapshot1700000000048';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD COLUMN IF NOT EXISTS "catalog_unit_price" decimal(10,2)
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD COLUMN IF NOT EXISTS "sale_campaign_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD COLUMN IF NOT EXISTS "sale_discount_percent" decimal(5,2)
    `);
    await queryRunner.query(`
      UPDATE "order_items"
      SET "catalog_unit_price" = "unit_price"
      WHERE "catalog_unit_price" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP COLUMN IF EXISTS "sale_discount_percent"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP COLUMN IF EXISTS "sale_campaign_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP COLUMN IF EXISTS "catalog_unit_price"
    `);
  }
}
