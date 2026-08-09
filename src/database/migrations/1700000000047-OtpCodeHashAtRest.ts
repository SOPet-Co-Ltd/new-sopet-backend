import { MigrationInterface, QueryRunner } from 'typeorm';

export class OtpCodeHashAtRest1700000000047 implements MigrationInterface {
  name = 'OtpCodeHashAtRest1700000000047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Invalidate any leftover plaintext OTPs before widening the column for hashes.
    await queryRunner.query(`
      UPDATE "otp_codes"
      SET "is_used" = true
      WHERE length("code") <= 6
    `);

    await queryRunner.query(`
      ALTER TABLE "otp_codes"
      ALTER COLUMN "code" TYPE character varying(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "otp_codes"
      SET "is_used" = true
      WHERE length("code") > 6
    `);

    await queryRunner.query(`
      ALTER TABLE "otp_codes"
      ALTER COLUMN "code" TYPE character varying(6)
      USING left("code", 6)
    `);
  }
}
