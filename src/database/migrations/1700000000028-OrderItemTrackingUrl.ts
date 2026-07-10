import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderItemTrackingUrl1700000000028 implements MigrationInterface {
  name = 'OrderItemTrackingUrl1700000000028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      ADD COLUMN "tracking_url" varchar(2048)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items"
      DROP COLUMN IF EXISTS "tracking_url"
    `);
  }
}
