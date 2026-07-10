import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentExpiresAt1700000000032 implements MigrationInterface {
  name = 'PaymentExpiresAt1700000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN "expires_at" TIMESTAMP
    `);

    await queryRunner.query(`
      UPDATE "payments"
      SET "expires_at" = "created_at" + INTERVAL '15 minutes'
      WHERE "payment_method" = 'promptpay'
        AND "status" = 'pending'
        AND "expires_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "expires_at"
    `);
  }
}
