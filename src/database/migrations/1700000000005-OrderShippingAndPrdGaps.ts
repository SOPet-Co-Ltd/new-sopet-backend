import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderShippingAndPrdGaps1700000000005 implements MigrationInterface {
  name = 'OrderShippingAndPrdGaps1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "dispute_issue_type_enum" AS ENUM(
        'not_received',
        'wrong_item',
        'damaged',
        'other'
      )
    `);

    await queryRunner.query(`
      ALTER TYPE "promotion_type_enum" ADD VALUE IF NOT EXISTS 'buy_x_get_y'
    `);
    await queryRunner.query(`
      ALTER TYPE "promotion_type_enum" ADD VALUE IF NOT EXISTS 'fixed_shipping_discount'
    `);
    await queryRunner.query(`
      ALTER TYPE "promotion_type_enum" ADD VALUE IF NOT EXISTS 'percentage_shipping_discount'
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "guest_email" varchar(255)
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "email_verified" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        RENAME COLUMN "address" TO "address_line1"
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        ADD COLUMN IF NOT EXISTS "amphoe" varchar(100)
    `);

    await queryRunner.query(`
      UPDATE "saved_addresses"
      SET "amphoe" = "district"
      WHERE "amphoe" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        ALTER COLUMN "amphoe" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "otp_codes"
        ALTER COLUMN "phone" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "otp_codes"
        ADD COLUMN IF NOT EXISTS "email" varchar(255)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_otp_codes_email_purpose"
        ON "otp_codes" ("email", "purpose")
    `);

    await queryRunner.query(`
      ALTER TABLE "promotions"
        ADD COLUMN IF NOT EXISTS "auto_apply" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "priority" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "conditions" jsonb NOT NULL DEFAULT '{}'
    `);

    await queryRunner.query(`
      ALTER TABLE "disputes"
        ADD COLUMN IF NOT EXISTS "issue_type" "dispute_issue_type_enum" NOT NULL DEFAULT 'other'
    `);

    await queryRunner.query(`
      CREATE TABLE "order_shipping_addresses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL UNIQUE,
        "saved_address_id" uuid,
        "full_name" varchar(255) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "address_line1" text NOT NULL,
        "address_line2" text,
        "tumbon" varchar(100),
        "amphoe" varchar(100) NOT NULL,
        "province" varchar(100) NOT NULL,
        "postal_code" varchar(10) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_order_shipping_addresses_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_order_shipping_addresses_saved_address"
          FOREIGN KEY ("saved_address_id") REFERENCES "saved_addresses"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO "order_shipping_addresses" (
        "order_id",
        "full_name",
        "phone",
        "address_line1",
        "amphoe",
        "province",
        "postal_code",
        "created_at"
      )
      SELECT
        "id",
        COALESCE("shipping_address"->>'fullName', ''),
        COALESCE("shipping_address"->>'phone', ''),
        COALESCE("shipping_address"->>'address', ''),
        COALESCE("shipping_address"->>'district', ''),
        COALESCE("shipping_address"->>'province', ''),
        COALESCE("shipping_address"->>'postalCode', ''),
        "created_at"
      FROM "orders"
      WHERE "shipping_address" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN "shipping_address"
    `);

    await queryRunner.query(`
      CREATE TABLE "dispute_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "dispute_id" uuid NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_dispute_images_dispute"
          FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_dispute_images_dispute_sort"
        ON "dispute_images" ("dispute_id", "sort_order")
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_banners" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar(255) NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "link_url" varchar(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "starts_at" timestamp,
        "ends_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_platform_banners_active_sort"
        ON "platform_banners" ("is_active", "sort_order")
    `);

    await queryRunner.query(`
      CREATE TABLE "user_notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "type" varchar(50) NOT NULL,
        "channel" "notification_channel_enum" NOT NULL,
        "subject" varchar(255),
        "message" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "is_read" boolean NOT NULL DEFAULT false,
        "is_sent" boolean NOT NULL DEFAULT false,
        "sent_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_user_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_notifications_user_created"
        ON "user_notifications" ("user_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_user_notifications_user_read"
        ON "user_notifications" ("user_id", "is_read")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_notifications" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_banners" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_images" CASCADE`);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN "shipping_address" jsonb
    `);

    await queryRunner.query(`
      UPDATE "orders" o
      SET "shipping_address" = jsonb_build_object(
        'fullName', sa."full_name",
        'phone', sa."phone",
        'address', sa."address_line1",
        'district', sa."amphoe",
        'province', sa."province",
        'postalCode', sa."postal_code"
      )
      FROM "order_shipping_addresses" sa
      WHERE sa."order_id" = o."id"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders"
        ALTER COLUMN "shipping_address" SET NOT NULL
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "order_shipping_addresses" CASCADE`);

    await queryRunner.query(`
      ALTER TABLE "disputes" DROP COLUMN IF EXISTS "issue_type"
    `);

    await queryRunner.query(`
      ALTER TABLE "promotions"
        DROP COLUMN IF EXISTS "conditions",
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "auto_apply"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_otp_codes_email_purpose"`);

    await queryRunner.query(`
      ALTER TABLE "otp_codes" DROP COLUMN IF EXISTS "email"
    `);

    await queryRunner.query(`
      ALTER TABLE "otp_codes"
        ALTER COLUMN "phone" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses" DROP COLUMN IF EXISTS "amphoe"
    `);

    await queryRunner.query(`
      ALTER TABLE "saved_addresses"
        RENAME COLUMN "address_line1" TO "address"
    `);

    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "email_verified"
    `);

    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "guest_email"
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS "dispute_issue_type_enum"`);
  }
}
