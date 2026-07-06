import { MigrationInterface, QueryRunner } from 'typeorm';

export class PrdGaps1700000000004 implements MigrationInterface {
  name = 'PrdGaps1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "payout_schedule_enum" AS ENUM('manual', 'daily', 'weekly', 'biweekly', 'monthly')
    `);

    await queryRunner.query(`
      CREATE TYPE "store_member_invitation_status_enum" AS ENUM('pending', 'accepted', 'expired', 'revoked')
    `);

    await queryRunner.query(`
      ALTER TABLE "customers"
        ADD COLUMN IF NOT EXISTS "date_of_birth" date,
        ADD COLUMN IF NOT EXISTS "profile_photo_url" varchar(500)
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        ADD COLUMN IF NOT EXISTS "address_line2" text,
        ADD COLUMN IF NOT EXISTS "tumbon" varchar(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "stores"
        ADD COLUMN IF NOT EXISTS "payout_schedule" "payout_schedule_enum" NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS "payout_schedule_paused" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE TABLE "favorites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_favorites_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_favorites_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_favorites_customer_product" UNIQUE ("customer_id", "product_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_favorites_customer_created" ON "favorites" ("customer_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "store_shipping_options" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "description" text,
        "price" decimal(10,2) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_store_shipping_options_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_shipping_options_store_active" ON "store_shipping_options" ("store_id", "is_active")
    `);

    await queryRunner.query(`
      CREATE TABLE "order_store_shippings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "shipping_option_id" uuid NOT NULL,
        "option_name" varchar(100) NOT NULL,
        "shipping_fee" decimal(10,2) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_order_store_shippings_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_order_store_shippings_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "fk_order_store_shippings_option" FOREIGN KEY ("shipping_option_id") REFERENCES "store_shipping_options"("id"),
        CONSTRAINT "uq_order_store_shippings_order_store" UNIQUE ("order_id", "store_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "store_member_invitations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "invited_by" uuid NOT NULL,
        "email" varchar(255) NOT NULL,
        "role" "store_member_role_enum" NOT NULL DEFAULT 'staff',
        "token" varchar(64) NOT NULL,
        "status" "store_member_invitation_status_enum" NOT NULL DEFAULT 'pending',
        "expires_at" timestamp NOT NULL,
        "accepted_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_member_invitations_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_store_member_invitations_inviter" FOREIGN KEY ("invited_by") REFERENCES "users"("id"),
        CONSTRAINT "uq_store_member_invitations_token" UNIQUE ("token")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_store_member_invitations_pending_email"
        ON "store_member_invitations" ("store_id", "email")
        WHERE "status" = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_store_member_invitations_pending_email"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_member_invitations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_store_shippings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_store_shipping_options_store_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_shipping_options"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_favorites_customer_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "favorites"`);
    await queryRunner.query(`
      ALTER TABLE "stores"
        DROP COLUMN IF EXISTS "payout_schedule_paused",
        DROP COLUMN IF EXISTS "payout_schedule"
    `);
    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        DROP COLUMN IF EXISTS "tumbon",
        DROP COLUMN IF EXISTS "address_line2"
    `);
    await queryRunner.query(`
      ALTER TABLE "customers"
        DROP COLUMN IF EXISTS "profile_photo_url",
        DROP COLUMN IF EXISTS "date_of_birth"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "store_member_invitation_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_schedule_enum"`);
  }
}
