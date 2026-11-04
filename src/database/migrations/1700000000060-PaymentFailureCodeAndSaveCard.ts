import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentFailureCodeAndSaveCard1700000000060 implements MigrationInterface {
  name = 'PaymentFailureCodeAndSaveCard1700000000060';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "failure_code" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "save_card_payload" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "save_card_payload"
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "failure_code"
    `);
  }
}
