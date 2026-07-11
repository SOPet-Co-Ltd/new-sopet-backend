import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplacementOrders1700000000035 implements MigrationInterface {
  name = 'ReplacementOrders1700000000035';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "source_dispute_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD CONSTRAINT "fk_orders_source_dispute"
          FOREIGN KEY ("source_dispute_id") REFERENCES "disputes"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_orders_source_dispute"
        ON "orders" ("source_dispute_id")
        WHERE "source_dispute_id" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "disputes"
        ADD COLUMN "replacement_order_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "disputes"
        ADD CONSTRAINT "fk_disputes_replacement_order"
          FOREIGN KEY ("replacement_order_id") REFERENCES "orders"("id")
          ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_disputes_replacement_order"
        ON "disputes" ("replacement_order_id")
        WHERE "replacement_order_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_disputes_replacement_order"`);
    await queryRunner.query(`
      ALTER TABLE "disputes"
        DROP CONSTRAINT IF EXISTS "fk_disputes_replacement_order"
    `);
    await queryRunner.query(`
      ALTER TABLE "disputes"
        DROP COLUMN IF EXISTS "replacement_order_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_source_dispute"`);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "fk_orders_source_dispute"
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
        DROP COLUMN IF EXISTS "source_dispute_id"
    `);
  }
}
