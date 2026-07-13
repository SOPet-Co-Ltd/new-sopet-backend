import { MigrationInterface, QueryRunner } from 'typeorm';

export class EmailVerificationTokens1700000000038 implements MigrationInterface {
  name = 'EmailVerificationTokens1700000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_verification_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(255) NOT NULL,
        "token" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_email_verification_tokens" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_email_verification_tokens_token" ON "email_verification_tokens" ("token")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_email_verification_tokens_email" ON "email_verification_tokens" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_email_verification_tokens_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_email_verification_tokens_token"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_verification_tokens"`);
  }
}
