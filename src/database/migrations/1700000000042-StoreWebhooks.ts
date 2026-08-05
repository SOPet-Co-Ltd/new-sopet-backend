import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreWebhooks1700000000042 implements MigrationInterface {
  name = 'StoreWebhooks1700000000042';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "store_webhooks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "url" varchar(2048) NOT NULL,
        "secret" varchar(128) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "events" jsonb NOT NULL DEFAULT '["order.create","order.payment_failed","order.paid","order.processing","order.on_hold","order.shipped","order.delivered","order.cancelled","order.refunded"]'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "uq_store_webhooks_store_id" UNIQUE ("store_id"),
        CONSTRAINT "fk_store_webhooks_store"
          FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_store_webhooks_store_id"
        ON "store_webhooks" ("store_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "store_webhooks"`);
  }
}
