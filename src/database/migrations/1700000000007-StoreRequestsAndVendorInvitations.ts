import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreRequestsAndVendorInvitations1700000000007 implements MigrationInterface {
  name = 'StoreRequestsAndVendorInvitations1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "store_request_status_enum" AS ENUM(
        'pending',
        'approved',
        'rejected'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "store_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendor_user_id" uuid NOT NULL,
        "store_name" varchar(255) NOT NULL,
        "description" text,
        "contact_phone" varchar(20),
        "contact_email" varchar(255),
        "address" text,
        "logo_url" varchar(500),
        "status" "store_request_status_enum" NOT NULL DEFAULT 'pending',
        "rejection_reason" text,
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "created_store_id" uuid,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_requests_vendor"
          FOREIGN KEY ("vendor_user_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_store_requests_reviewer"
          FOREIGN KEY ("reviewed_by") REFERENCES "users"("id"),
        CONSTRAINT "fk_store_requests_store"
          FOREIGN KEY ("created_store_id") REFERENCES "stores"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_requests_vendor"
        ON "store_requests" ("vendor_user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_requests_status"
        ON "store_requests" ("status")
    `);

    await queryRunner.query(`
      CREATE TYPE "vendor_invitation_status_enum" AS ENUM(
        'pending',
        'accepted',
        'expired',
        'revoked'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "vendor_invitations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "token" varchar(64) NOT NULL,
        "invited_by" uuid NOT NULL,
        "status" "vendor_invitation_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" timestamp NOT NULL,
        "accepted_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_vendor_invitations_inviter"
          FOREIGN KEY ("invited_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_vendor_invitations_token" UNIQUE ("token")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_vendor_invitations_pending_email"
        ON "vendor_invitations" ("email")
        WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_invitations" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vendor_invitation_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_requests" CASCADE`);
    await queryRunner.query(`DROP TYPE IF EXISTS "store_request_status_enum"`);
  }
}
