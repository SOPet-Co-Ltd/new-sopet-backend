import { MigrationInterface, QueryRunner } from 'typeorm';

export class DisputeStoreAndItems1700000000034 implements MigrationInterface {
  name = 'DisputeStoreAndItems1700000000034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "disputes"
        ADD COLUMN "store_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "disputes" d
      SET "store_id" = (
        SELECT oi."store_id"
        FROM "order_items" oi
        WHERE oi."order_id" = d."order_id"
        ORDER BY oi."created_at" ASC
        LIMIT 1
      )
      WHERE d."store_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "disputes"
        ALTER COLUMN "store_id" SET NOT NULL,
        ADD CONSTRAINT "fk_disputes_store"
          FOREIGN KEY ("store_id") REFERENCES "stores"("id")
    `);

    await queryRunner.query(`
      CREATE TABLE "dispute_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "dispute_id" uuid NOT NULL,
        "order_item_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dispute_items" PRIMARY KEY ("id"),
        CONSTRAINT "fk_dispute_items_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_dispute_items_order_item"
          FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id"),
        CONSTRAINT "uq_dispute_items_dispute_order_item"
          UNIQUE ("dispute_id", "order_item_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_dispute_items_order_item"
        ON "dispute_items" ("order_item_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_disputes_store_status"
        ON "disputes" ("store_id", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_store_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_items" CASCADE`);
    await queryRunner.query(`
      ALTER TABLE "disputes"
        DROP CONSTRAINT IF EXISTS "fk_disputes_store",
        DROP COLUMN IF EXISTS "store_id"
    `);
  }
}
