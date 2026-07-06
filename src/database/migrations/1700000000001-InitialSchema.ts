import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000001 implements MigrationInterface {
  name = 'InitialSchema1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable UUID extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Create ENUM types
    await queryRunner.query(`
      CREATE TYPE "user_role_enum" AS ENUM('admin', 'vendor');
      CREATE TYPE "store_status_enum" AS ENUM('pending', 'approved', 'rejected', 'suspended');
      CREATE TYPE "store_member_role_enum" AS ENUM('owner', 'manager', 'staff');
      CREATE TYPE "product_status_enum" AS ENUM('draft', 'published', 'archived');
      CREATE TYPE "inventory_transaction_type_enum" AS ENUM('purchase', 'sale', 'adjustment', 'return', 'damaged');
      CREATE TYPE "order_status_enum" AS ENUM('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded');
      CREATE TYPE "payment_method_enum" AS ENUM('promptpay', 'credit_card', 'cod');
      CREATE TYPE "fulfillment_status_enum" AS ENUM('pending', 'processing', 'shipped', 'delivered', 'cancelled');
      CREATE TYPE "promotion_type_enum" AS ENUM('percentage', 'fixed_amount', 'free_shipping');
      CREATE TYPE "promotion_scope_enum" AS ENUM('platform', 'store');
      CREATE TYPE "payout_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed');
      CREATE TYPE "review_status_enum" AS ENUM('pending', 'approved', 'rejected');
      CREATE TYPE "dispute_status_enum" AS ENUM('open', 'in_progress', 'resolved', 'closed');
      CREATE TYPE "dispute_resolution_enum" AS ENUM('refunded', 'replaced', 'rejected', 'withdrawn');
      CREATE TYPE "dispute_message_sender_enum" AS ENUM('customer', 'vendor', 'admin');
      CREATE TYPE "payment_method_type_enum" AS ENUM('credit_card', 'debit_card');
      CREATE TYPE "notification_type_enum" AS ENUM('order_confirmation', 'order_shipped', 'order_delivered', 'promotion', 'review_request', 'dispute_update');
      CREATE TYPE "notification_channel_enum" AS ENUM('email', 'sms', 'push');
      CREATE TYPE "admin_action_enum" AS ENUM('approve_store', 'reject_store', 'suspend_store', 'approve_review', 'reject_review', 'resolve_dispute', 'process_payout', 'update_settings');
      CREATE TYPE "otp_purpose_enum" AS ENUM('login', 'verification');
    `);

    // Users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(255) NOT NULL,
        "full_name" varchar(255) NOT NULL,
        "role" "user_role_enum" NOT NULL DEFAULT 'vendor',
        "is_active" boolean NOT NULL DEFAULT true,
        "last_login_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      )
    `);

    // Customers table
    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone" varchar(20) NOT NULL,
        "full_name" varchar(255),
        "email" varchar(255),
        "is_verified" boolean NOT NULL DEFAULT false,
        "last_login_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp
      )
    `);

    // OTP codes table
    await queryRunner.query(`
      CREATE TABLE "otp_codes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "phone" varchar(20) NOT NULL,
        "code" varchar(6) NOT NULL,
        "purpose" "otp_purpose_enum" NOT NULL DEFAULT 'login',
        "is_used" boolean NOT NULL DEFAULT false,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now()
      )
    `);

    // Stores table
    await queryRunner.query(`
      CREATE TABLE "stores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "description" text,
        "logo_url" varchar(500),
        "banner_url" varchar(500),
        "status" "store_status_enum" NOT NULL DEFAULT 'pending',
        "approved_by" uuid,
        "approved_at" timestamp,
        "rejection_reason" text,
        "contact_phone" varchar(20),
        "contact_email" varchar(255),
        "address" text,
        "bank_account_name" varchar(255),
        "bank_account_number" varchar(50),
        "bank_name" varchar(100),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_stores_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id")
      )
    `);

    // Store members table
    await queryRunner.query(`
      CREATE TABLE "store_members" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" "store_member_role_enum" NOT NULL DEFAULT 'staff',
        "permissions" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_members_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "fk_store_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id")
      )
    `);

    // Products table
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "name" varchar(255) NOT NULL,
        "slug" varchar(255) NOT NULL,
        "description" text,
        "base_price" decimal(10,2) NOT NULL,
        "status" "product_status_enum" NOT NULL DEFAULT 'draft',
        "category" varchar(100),
        "tags" text[] DEFAULT '{}',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "search_vector" tsvector,
        "average_rating" decimal(3,2) NOT NULL DEFAULT 0,
        "review_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_products_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      )
    `);

    // Product images table
    await queryRunner.query(`
      CREATE TABLE "product_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "url" varchar(500) NOT NULL,
        "alt_text" varchar(255),
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_product_images_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    // Product variants table
    await queryRunner.query(`
      CREATE TABLE "product_variants" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "sku" varchar(100) NOT NULL,
        "options" jsonb NOT NULL DEFAULT '{}',
        "price_adjustment" decimal(10,2) NOT NULL DEFAULT 0,
        "stock_quantity" integer NOT NULL DEFAULT 0,
        "low_stock_threshold" integer DEFAULT 10,
        "image_url" varchar(500),
        "weight" decimal(10,2),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_product_variants_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    // Inventory transactions table
    await queryRunner.query(`
      CREATE TABLE "inventory_transactions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "variant_id" uuid NOT NULL,
        "type" "inventory_transaction_type_enum" NOT NULL,
        "quantity_change" integer NOT NULL,
        "quantity_after" integer NOT NULL,
        "reference_id" uuid,
        "reference_type" varchar(50),
        "notes" text,
        "performed_by" uuid,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_inventory_transactions_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
      )
    `);

    // Orders table
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_number" varchar(50) NOT NULL,
        "customer_id" uuid,
        "guest_phone" varchar(20),
        "guest_name" varchar(255),
        "status" "order_status_enum" NOT NULL DEFAULT 'pending_payment',
        "subtotal" decimal(10,2) NOT NULL,
        "discount_amount" decimal(10,2) NOT NULL DEFAULT 0,
        "shipping_fee" decimal(10,2) NOT NULL DEFAULT 0,
        "total" decimal(10,2) NOT NULL,
        "payment_method" "payment_method_enum" NOT NULL,
        "payment_reference" varchar(255),
        "paid_at" timestamp,
        "shipping_address" jsonb NOT NULL,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_orders_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Order items table
    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "store_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "product_name" varchar(255) NOT NULL,
        "variant_options" jsonb NOT NULL DEFAULT '{}',
        "unit_price" decimal(10,2) NOT NULL,
        "quantity" integer NOT NULL,
        "subtotal" decimal(10,2) NOT NULL,
        "fulfillment_status" "fulfillment_status_enum" NOT NULL DEFAULT 'pending',
        "tracking_number" varchar(100),
        "shipped_at" timestamp,
        "delivered_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_order_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_order_items_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "fk_order_items_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
      )
    `);

    // Order status history table
    await queryRunner.query(`
      CREATE TABLE "order_status_history" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "status" "order_status_enum" NOT NULL,
        "changed_by" uuid,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_order_status_history_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    // Promotions table
    await queryRunner.query(`
      CREATE TABLE "promotions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid,
        "code" varchar(50) NOT NULL,
        "name" varchar(255) NOT NULL,
        "description" text,
        "type" "promotion_type_enum" NOT NULL,
        "scope" "promotion_scope_enum" NOT NULL DEFAULT 'store',
        "discount_value" decimal(10,2) NOT NULL,
        "min_purchase_amount" decimal(10,2),
        "max_discount_amount" decimal(10,2),
        "usage_limit" integer,
        "usage_per_customer" integer NOT NULL DEFAULT 1,
        "usage_count" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "starts_at" timestamp,
        "expires_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_promotions_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      )
    `);

    // Promotion usages table
    await queryRunner.query(`
      CREATE TABLE "promotion_usages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "promotion_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "discount_amount" decimal(10,2) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_promotion_usages_promotion" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id"),
        CONSTRAINT "fk_promotion_usages_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    // Payouts table
    await queryRunner.query(`
      CREATE TABLE "payouts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "amount" decimal(10,2) NOT NULL,
        "fee" decimal(10,2) NOT NULL DEFAULT 0,
        "net_amount" decimal(10,2) NOT NULL,
        "status" "payout_status_enum" NOT NULL DEFAULT 'pending',
        "transfer_reference" varchar(255),
        "processed_by" uuid,
        "processed_at" timestamp,
        "failure_reason" text,
        "notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payouts_store" FOREIGN KEY ("store_id") REFERENCES "stores"("id")
      )
    `);

    // Payout items table
    await queryRunner.query(`
      CREATE TABLE "payout_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "payout_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "amount" decimal(10,2) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payout_items_payout" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id"),
        CONSTRAINT "fk_payout_items_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    // Reviews table
    await queryRunner.query(`
      CREATE TABLE "reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "order_id" uuid NOT NULL,
        "rating" integer NOT NULL,
        "comment" text,
        "status" "review_status_enum" NOT NULL DEFAULT 'pending',
        "moderated_by" uuid,
        "moderated_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_reviews_product" FOREIGN KEY ("product_id") REFERENCES "products"("id"),
        CONSTRAINT "fk_reviews_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id"),
        CONSTRAINT "fk_reviews_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    // Review images table
    await queryRunner.query(`
      CREATE TABLE "review_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "url" varchar(500) NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_review_images_review" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE
      )
    `);

    // Disputes table
    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "reason" text NOT NULL,
        "status" "dispute_status_enum" NOT NULL DEFAULT 'open',
        "resolution" "dispute_resolution_enum",
        "resolved_by" uuid,
        "resolved_at" timestamp,
        "resolution_notes" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_disputes_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
        CONSTRAINT "fk_disputes_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Dispute messages table
    await queryRunner.query(`
      CREATE TABLE "dispute_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "dispute_id" uuid NOT NULL,
        "sender_type" "dispute_message_sender_enum" NOT NULL,
        "sender_id" uuid NOT NULL,
        "message" text NOT NULL,
        "attachments" text[] DEFAULT '{}',
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_dispute_messages_dispute" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id")
      )
    `);

    // Saved addresses table
    await queryRunner.query(`
      CREATE TABLE "saved_addresses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid NOT NULL,
        "full_name" varchar(255) NOT NULL,
        "phone" varchar(20) NOT NULL,
        "address" text NOT NULL,
        "district" varchar(100) NOT NULL,
        "province" varchar(100) NOT NULL,
        "postal_code" varchar(10) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "label" varchar(50),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_saved_addresses_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Saved payment methods table
    await queryRunner.query(`
      CREATE TABLE "saved_payment_methods" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid NOT NULL,
        "type" "payment_method_type_enum" NOT NULL,
        "omise_card_token" varchar(255) NOT NULL,
        "last_four" varchar(4) NOT NULL,
        "brand" varchar(50) NOT NULL,
        "expiry_month" integer NOT NULL,
        "expiry_year" integer NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "deleted_at" timestamp,
        CONSTRAINT "fk_saved_payment_methods_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Carts table
    await queryRunner.query(`
      CREATE TABLE "carts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid,
        "session_id" varchar(255),
        "merged_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_carts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Cart items table
    await queryRunner.query(`
      CREATE TABLE "cart_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "cart_id" uuid NOT NULL,
        "variant_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_cart_items_cart" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_cart_items_variant" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id")
      )
    `);

    // Notifications table
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_id" uuid NOT NULL,
        "type" "notification_type_enum" NOT NULL,
        "channel" "notification_channel_enum" NOT NULL,
        "subject" varchar(255),
        "message" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "is_sent" boolean NOT NULL DEFAULT false,
        "sent_at" timestamp,
        "error_message" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_notifications_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
      )
    `);

    // Admin logs table
    await queryRunner.query(`
      CREATE TABLE "admin_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admin_id" uuid NOT NULL,
        "action" "admin_action_enum" NOT NULL,
        "entity_type" varchar(50) NOT NULL,
        "entity_id" uuid NOT NULL,
        "details" jsonb NOT NULL DEFAULT '{}',
        "ip_address" varchar(45),
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_admin_logs_admin" FOREIGN KEY ("admin_id") REFERENCES "users"("id")
      )
    `);

    // Settings table
    await queryRunner.query(`
      CREATE TABLE "settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" varchar(100) NOT NULL,
        "value" jsonb NOT NULL,
        "description" text,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "settings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "dispute_messages" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "review_images" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "reviews" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_payment_methods" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_addresses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cart_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "carts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payouts" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotion_usages" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "promotions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_status_history" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_transactions" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_variants" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_images" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "store_members" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "stores" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "otp_codes" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customers" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users" CASCADE`);

    // Drop ENUM types
    await queryRunner.query(`DROP TYPE IF EXISTS "otp_purpose_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "admin_action_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_channel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notification_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dispute_message_sender_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dispute_resolution_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "dispute_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "review_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "promotion_scope_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "promotion_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "fulfillment_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_method_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "order_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "inventory_transaction_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "product_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "store_member_role_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "store_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
