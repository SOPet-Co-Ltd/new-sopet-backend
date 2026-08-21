import { MigrationInterface, QueryRunner } from 'typeorm';

export class TokenVersionAndOtpAttempts1700000000053 implements MigrationInterface {
  name = 'TokenVersionAndOtpAttempts1700000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "token_version" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "otp_codes"
      ADD COLUMN IF NOT EXISTS "failed_attempts" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "otp_codes" DROP COLUMN IF EXISTS "failed_attempts"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "token_version"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "token_version"`);
  }
}
