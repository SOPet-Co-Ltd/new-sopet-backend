import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformAds1700000000016 implements MigrationInterface {
  name = 'PlatformAds1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_ads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar(255) NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "link_url" varchar(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "starts_at" timestamp,
        "ends_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_ads_active_sort"
        ON "platform_ads" ("is_active", "sort_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_ads" CASCADE`);
  }
}
