import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShippingProviders1700000000008 implements MigrationInterface {
  name = 'ShippingProviders1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shipping_providers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "store_shipping_options"
      ADD COLUMN IF NOT EXISTS "provider_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "store_shipping_options"
      ADD CONSTRAINT "fk_store_shipping_options_provider"
      FOREIGN KEY ("provider_id") REFERENCES "shipping_providers"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_shipping_options_provider"
      ON "store_shipping_options" ("provider_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "store_shipping_options"
      DROP CONSTRAINT IF EXISTS "fk_store_shipping_options_provider"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_store_shipping_options_provider"
    `);

    await queryRunner.query(`
      ALTER TABLE "store_shipping_options"
      DROP COLUMN IF EXISTS "provider_id"
    `);

    await queryRunner.query(`DROP TABLE "shipping_providers" CASCADE`);
  }
}
