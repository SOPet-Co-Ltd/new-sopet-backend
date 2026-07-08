import { MigrationInterface, QueryRunner } from 'typeorm';

export class PaymentOmiseUrls1700000000021 implements MigrationInterface {
  name = 'PaymentOmiseUrls1700000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN "authorize_uri" varchar(2048),
      ADD COLUMN "qr_code_url" varchar(2048)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "authorize_uri",
      DROP COLUMN IF EXISTS "qr_code_url"
    `);
  }
}
