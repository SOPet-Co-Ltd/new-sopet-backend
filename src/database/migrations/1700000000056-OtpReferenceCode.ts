import { MigrationInterface, QueryRunner } from 'typeorm';

export class OtpReferenceCode1700000000056 implements MigrationInterface {
  name = 'OtpReferenceCode1700000000056';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "otp_codes"
      ADD COLUMN IF NOT EXISTS "reference_code" varchar(6)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "otp_codes" DROP COLUMN IF EXISTS "reference_code"`);
  }
}
