import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderCustomerImportSource1700000000055 implements MigrationInterface {
  name = 'OrderCustomerImportSource1700000000055';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "data_source_enum" AS ENUM ('platform', 'vendor_import')
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "source" "data_source_enum" NOT NULL DEFAULT 'platform'
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_orders_source"
        ON "orders" ("source")
    `);

    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN "source" "data_source_enum" NOT NULL DEFAULT 'platform'
    `);

    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN "import_store_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN "external_id" varchar(100) NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_customers_import_store_id"
        ON "customers" ("import_store_id")
        WHERE "import_store_id" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_customers_import_store_id"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "external_id"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "import_store_id"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_source"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "data_source_enum"`);
  }
}
