import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreApiKeys1700000000015 implements MigrationInterface {
  name = 'StoreApiKeys1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "store_api_keys" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "key_prefix" varchar(24) NOT NULL,
        "key_hash" varchar(255) NOT NULL,
        "created_by" uuid NOT NULL,
        "last_used_at" timestamp,
        "revoked_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_api_keys_store"
          FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "fk_store_api_keys_creator"
          FOREIGN KEY ("created_by") REFERENCES "users"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_api_keys_store_id"
        ON "store_api_keys" ("store_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_api_keys_key_prefix"
        ON "store_api_keys" ("key_prefix")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "store_api_keys"`);
  }
}
