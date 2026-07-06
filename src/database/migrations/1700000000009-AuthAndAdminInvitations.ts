import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuthAndAdminInvitations1700000000009 implements MigrationInterface {
  name = 'AuthAndAdminInvitations1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "password_reset_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" varchar(255) NOT NULL,
        "token" varchar(64) NOT NULL,
        "expires_at" timestamp NOT NULL,
        "used_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_password_reset_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "uq_password_reset_tokens_token" UNIQUE ("token")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_password_reset_tokens_email" ON "password_reset_tokens"("email")`,
    );

    await queryRunner.query(`
      CREATE TYPE "admin_invitation_status_enum" AS ENUM('pending', 'accepted', 'expired', 'revoked')
    `);
    await queryRunner.query(`
      CREATE TABLE "admin_invitations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" varchar(255) NOT NULL,
        "token" varchar(64) NOT NULL,
        "invited_by" uuid NOT NULL,
        "status" "admin_invitation_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" timestamp NOT NULL,
        "accepted_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "pk_admin_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_admin_invitations_token" UNIQUE ("token"),
        CONSTRAINT "fk_admin_invitations_invited_by" FOREIGN KEY ("invited_by") REFERENCES "users"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_admin_invitations_pending_email" ON "admin_invitations"("email") WHERE status = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_invitations" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "admin_invitation_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_tokens" CASCADE`);
  }
}
