import { MigrationInterface, QueryRunner } from 'typeorm';

export class BeamPspAndBankVerification1791643722800 implements MigrationInterface {
  name = 'BeamPspAndBankVerification1791643722800';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "psp" character varying(20)
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "psp_charge_id" character varying(255)
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "qr_code_image" text
    `);
    await queryRunner.query(`
      UPDATE "payments"
      SET "psp" = 'omise'
      WHERE "omise_charge_id" IS NOT NULL AND ("psp" IS NULL OR "psp" = '')
    `);
    await queryRunner.query(`
      UPDATE "payments"
      SET "psp_charge_id" = "omise_charge_id"
      WHERE "omise_charge_id" IS NOT NULL AND ("psp_charge_id" IS NULL OR "psp_charge_id" = '')
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ADD COLUMN IF NOT EXISTS "psp" character varying(20)
    `);
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ADD COLUMN IF NOT EXISTS "psp_card_token" character varying(255)
    `);
    await queryRunner.query(`
      UPDATE "saved_payment_methods"
      SET "psp" = 'omise'
      WHERE "psp" IS NULL OR "psp" = ''
    `);
    await queryRunner.query(`
      UPDATE "saved_payment_methods"
      SET "psp_card_token" = "omise_card_token"
      WHERE "omise_card_token" IS NOT NULL
        AND ("psp_card_token" IS NULL OR "psp_card_token" = '')
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "store_bank_account_verification_status_enum" AS ENUM (
          'unverified',
          'pending_review',
          'verified',
          'rejected'
        );
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "bank_account_verification_status"
        "store_bank_account_verification_status_enum"
        NOT NULL DEFAULT 'unverified'
    `);
    await queryRunner.query(`
      ALTER TABLE "stores"
      ADD COLUMN IF NOT EXISTS "bank_account_rejection_reason" text
    `);
    await queryRunner.query(`
      UPDATE "stores"
      SET "bank_account_verification_status" = 'pending_review'
      WHERE (
        "bank_account_name" IS NOT NULL
        OR "bank_account_number" IS NOT NULL
        OR "bank_name" IS NOT NULL
        OR "bank_code" IS NOT NULL
      )
      AND "bank_account_verification_status" = 'unverified'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stores" DROP COLUMN IF EXISTS "bank_account_rejection_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stores" DROP COLUMN IF EXISTS "bank_account_verification_status"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "store_bank_account_verification_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "saved_payment_methods" DROP COLUMN IF EXISTS "psp_card_token"`,
    );
    await queryRunner.query(`ALTER TABLE "saved_payment_methods" DROP COLUMN IF EXISTS "psp"`);

    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "qr_code_image"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "psp_charge_id"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "psp"`);
  }
}
