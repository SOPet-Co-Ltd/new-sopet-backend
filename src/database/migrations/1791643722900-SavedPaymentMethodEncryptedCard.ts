import { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedPaymentMethodEncryptedCard1791643722900 implements MigrationInterface {
  name = 'SavedPaymentMethodEncryptedCard1791643722900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ADD COLUMN IF NOT EXISTS "cardholder_name_enc" text,
      ADD COLUMN IF NOT EXISTS "pan_enc" text,
      ADD COLUMN IF NOT EXISTS "expiry_enc" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      DROP COLUMN IF EXISTS "expiry_enc",
      DROP COLUMN IF EXISTS "pan_enc",
      DROP COLUMN IF EXISTS "cardholder_name_enc"
    `);
  }
}
