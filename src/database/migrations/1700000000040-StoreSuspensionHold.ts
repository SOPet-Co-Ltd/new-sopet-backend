import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreSuspensionHold1700000000040 implements MigrationInterface {
  name = 'StoreSuspensionHold1700000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "order_status_enum" ADD VALUE IF NOT EXISTS 'on_hold'
    `);
    await queryRunner.query(`
      ALTER TYPE "fulfillment_status_enum" ADD VALUE IF NOT EXISTS 'on_hold'
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items"
        ADD COLUMN IF NOT EXISTS "previous_fulfillment_status" "fulfillment_status_enum",
        ADD COLUMN IF NOT EXISTS "hold_started_at" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "previous_status" "order_status_enum"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_order_items_fulfillment_status_hold_started_at"
        ON "order_items" ("fulfillment_status", "hold_started_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_order_items_fulfillment_status_hold_started_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "previous_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "order_items"
        DROP COLUMN IF EXISTS "hold_started_at",
        DROP COLUMN IF EXISTS "previous_fulfillment_status"
    `);

    // Postgres cannot remove enum values safely; leave 'on_hold' on both enums (forward-only).
  }
}
