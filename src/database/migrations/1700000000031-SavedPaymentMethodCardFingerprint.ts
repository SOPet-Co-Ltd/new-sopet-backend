import { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedPaymentMethodCardFingerprint1700000000031 implements MigrationInterface {
  name = 'SavedPaymentMethodCardFingerprint1700000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ADD COLUMN IF NOT EXISTS "card_fingerprint" varchar(255)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_saved_payment_methods_customer_fingerprint"
      ON "saved_payment_methods" ("customer_id", "card_fingerprint")
      WHERE "card_fingerprint" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_saved_payment_methods_customer_fingerprint"
    `);
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      DROP COLUMN IF EXISTS "card_fingerprint"
    `);
  }
}
