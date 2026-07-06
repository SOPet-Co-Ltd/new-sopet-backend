import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductsAndPlatformSponsors1700000000010 implements MigrationInterface {
  name = 'ProductsAndPlatformSponsors1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "warning" varchar(1000)`);
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN "expiry_date" date`);
    await queryRunner.query(
      `ALTER TABLE "product_images" ADD COLUMN "is_thumbnail" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE "platform_sponsors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" varchar(255) NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "link_url" varchar(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "starts_at" timestamp,
        "ends_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "pk_platform_sponsors" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_platform_sponsors_active_sort" ON "platform_sponsors"("is_active", "sort_order")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_sponsors" CASCADE`);
    await queryRunner.query(`ALTER TABLE "product_images" DROP COLUMN IF EXISTS "is_thumbnail"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "expiry_date"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "warning"`);
  }
}
