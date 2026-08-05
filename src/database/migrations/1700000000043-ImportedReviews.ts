import { MigrationInterface, QueryRunner } from 'typeorm';

export class ImportedReviews1700000000043 implements MigrationInterface {
  name = 'ImportedReviews1700000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "review_source_enum" AS ENUM ('customer', 'vendor_import')
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews"
        ADD COLUMN "source" "review_source_enum" NOT NULL DEFAULT 'customer'
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews"
        ALTER COLUMN "customer_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews"
        ALTER COLUMN "order_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_reviews_source_status"
        ON "reviews" ("source", "status")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reviews_source_status"`);

    await queryRunner.query(`
      DELETE FROM "reviews" WHERE "customer_id" IS NULL OR "order_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews"
        ALTER COLUMN "customer_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews"
        ALTER COLUMN "order_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "reviews" DROP COLUMN "source"
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS "review_source_enum"`);
  }
}
