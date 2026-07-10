import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderItemFulfillmentProvider1700000000029 implements MigrationInterface {
  name = 'OrderItemFulfillmentProvider1700000000029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD COLUMN IF NOT EXISTS "fulfillment_provider" varchar(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP COLUMN IF EXISTS "fulfillment_provider"
    `);
  }
}
