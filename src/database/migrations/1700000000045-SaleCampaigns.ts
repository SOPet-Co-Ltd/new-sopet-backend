import { MigrationInterface, QueryRunner } from 'typeorm';

export class SaleCampaigns1700000000045 implements MigrationInterface {
  name = 'SaleCampaigns1700000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sale_campaigns" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "store_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "starts_at" TIMESTAMP,
        "expires_at" TIMESTAMP,
        "is_active" boolean NOT NULL DEFAULT true,
        "priority" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        CONSTRAINT "FK_sale_campaigns_store"
          FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_campaigns_store_active"
        ON "sale_campaigns" ("store_id", "is_active")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_campaigns_store_window"
        ON "sale_campaigns" ("store_id", "starts_at", "expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sale_campaign_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "campaign_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "variant_id" uuid,
        "compare_at_price" numeric(10,2),
        "discount_percent" numeric(5,2),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_sale_campaign_items_campaign"
          FOREIGN KEY ("campaign_id") REFERENCES "sale_campaigns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sale_campaign_items_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_sale_campaign_items_variant"
          FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_campaign_items_campaign"
        ON "sale_campaign_items" ("campaign_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_campaign_items_product"
        ON "sale_campaign_items" ("product_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sale_campaign_items_variant"
        ON "sale_campaign_items" ("variant_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sale_campaign_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sale_campaigns"`);
  }
}
