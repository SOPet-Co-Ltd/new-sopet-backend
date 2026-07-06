import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIndexes1700000000002 implements MigrationInterface {
  name = 'AddIndexes1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_users_email" ON "users"("email") WHERE "deleted_at" IS NULL`,
    );

    // Customers indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_customers_phone" ON "customers"("phone") WHERE "deleted_at" IS NULL`,
    );

    // OTP codes indexes
    await queryRunner.query(
      `CREATE INDEX "idx_otp_codes_phone_purpose" ON "otp_codes"("phone", "purpose")`,
    );

    // Stores indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_stores_slug" ON "stores"("slug") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "idx_stores_status" ON "stores"("status")`);
    await queryRunner.query(`CREATE INDEX "idx_stores_owner_id" ON "stores"("owner_id")`);

    // Store members indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_store_members_user_store" ON "store_members"("user_id", "store_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_store_members_store_id" ON "store_members"("store_id")`,
    );

    // Products indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_products_store_slug" ON "products"("store_id", "slug") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_products_store_status" ON "products"("store_id", "status")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_products_status" ON "products"("status")`);
    await queryRunner.query(
      `CREATE INDEX "idx_products_search_vector" ON "products" USING GIN("search_vector")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_products_tags" ON "products" USING GIN("tags")`);

    // Product images indexes
    await queryRunner.query(
      `CREATE INDEX "idx_product_images_product_sort" ON "product_images"("product_id", "sort_order")`,
    );

    // Product variants indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_product_variants_product_sku" ON "product_variants"("product_id", "sku") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(`CREATE INDEX "idx_product_variants_sku" ON "product_variants"("sku")`);

    // Inventory transactions indexes
    await queryRunner.query(
      `CREATE INDEX "idx_inventory_transactions_variant_created" ON "inventory_transactions"("variant_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_inventory_transactions_type" ON "inventory_transactions"("type")`,
    );

    // Orders indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_orders_order_number" ON "orders"("order_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_customer_created" ON "orders"("customer_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_orders_guest_phone" ON "orders"("guest_phone")`);
    await queryRunner.query(`CREATE INDEX "idx_orders_status" ON "orders"("status")`);

    // Order items indexes
    await queryRunner.query(`CREATE INDEX "idx_order_items_order_id" ON "order_items"("order_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_order_items_store_fulfillment" ON "order_items"("store_id", "fulfillment_status", "created_at")`,
    );

    // Order status history indexes
    await queryRunner.query(
      `CREATE INDEX "idx_order_status_history_order_created" ON "order_status_history"("order_id", "created_at")`,
    );

    // Promotions indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_promotions_code" ON "promotions"("code") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promotions_store_active" ON "promotions"("store_id", "is_active")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promotions_scope_active" ON "promotions"("scope", "is_active")`,
    );

    // Promotion usages indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_promotion_usages_promotion_order" ON "promotion_usages"("promotion_id", "order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_promotion_usages_order_id" ON "promotion_usages"("order_id")`,
    );

    // Payouts indexes
    await queryRunner.query(
      `CREATE INDEX "idx_payouts_store_status_created" ON "payouts"("store_id", "status", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_payouts_status" ON "payouts"("status")`);

    // Payout items indexes
    await queryRunner.query(
      `CREATE INDEX "idx_payout_items_payout_id" ON "payout_items"("payout_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_payout_items_order_id" ON "payout_items"("order_id")`,
    );

    // Reviews indexes
    await queryRunner.query(
      `CREATE INDEX "idx_reviews_product_status" ON "reviews"("product_id", "status")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_reviews_customer_id" ON "reviews"("customer_id")`);
    await queryRunner.query(`CREATE INDEX "idx_reviews_order_id" ON "reviews"("order_id")`);

    // Review images indexes
    await queryRunner.query(
      `CREATE INDEX "idx_review_images_review_id" ON "review_images"("review_id")`,
    );

    // Disputes indexes
    await queryRunner.query(`CREATE INDEX "idx_disputes_order_id" ON "disputes"("order_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_disputes_customer_status" ON "disputes"("customer_id", "status")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_disputes_status" ON "disputes"("status")`);

    // Dispute messages indexes
    await queryRunner.query(
      `CREATE INDEX "idx_dispute_messages_dispute_created" ON "dispute_messages"("dispute_id", "created_at")`,
    );

    // Saved addresses indexes
    await queryRunner.query(
      `CREATE INDEX "idx_saved_addresses_customer_default" ON "saved_addresses"("customer_id", "is_default")`,
    );

    // Saved payment methods indexes
    await queryRunner.query(
      `CREATE INDEX "idx_saved_payment_methods_customer_default" ON "saved_payment_methods"("customer_id", "is_default")`,
    );

    // Carts indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_carts_customer_id" ON "carts"("customer_id") WHERE "customer_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_carts_session_id" ON "carts"("session_id") WHERE "session_id" IS NOT NULL`,
    );

    // Cart items indexes
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_cart_items_cart_variant" ON "cart_items"("cart_id", "variant_id")`,
    );

    // Notifications indexes
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_customer_created" ON "notifications"("customer_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_notifications_type" ON "notifications"("type")`);

    // Admin logs indexes
    await queryRunner.query(
      `CREATE INDEX "idx_admin_logs_admin_created" ON "admin_logs"("admin_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "idx_admin_logs_action" ON "admin_logs"("action")`);
    await queryRunner.query(
      `CREATE INDEX "idx_admin_logs_entity" ON "admin_logs"("entity_type", "entity_id")`,
    );

    // Settings indexes
    await queryRunner.query(`CREATE UNIQUE INDEX "idx_settings_key" ON "settings"("key")`);

    // Full-text search trigger for products
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_product_search_vector()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
          setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'C');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trigger_update_product_search_vector
      BEFORE INSERT OR UPDATE ON products
      FOR EACH ROW
      EXECUTE FUNCTION update_product_search_vector();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger and function
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trigger_update_product_search_vector ON products`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS update_product_search_vector`);

    // Drop all indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_settings_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_admin_logs_entity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_admin_logs_action"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_admin_logs_admin_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_notifications_customer_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cart_items_cart_variant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_carts_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_carts_customer_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_saved_payment_methods_customer_default"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_saved_addresses_customer_default"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_dispute_messages_dispute_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_customer_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_disputes_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_review_images_review_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reviews_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reviews_customer_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_reviews_product_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payout_items_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payout_items_payout_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payouts_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payouts_store_status_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_promotion_usages_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_promotion_usages_promotion_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_promotions_scope_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_promotions_store_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_promotions_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_status_history_order_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_items_store_fulfillment"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_items_order_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_guest_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_customer_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_order_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inventory_transactions_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_inventory_transactions_variant_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_sku"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_variants_product_sku"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_product_images_product_sort"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_tags"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_search_vector"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_store_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_products_store_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_store_members_store_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_store_members_user_store"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stores_owner_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stores_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_stores_slug"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_otp_codes_phone_purpose"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_customers_phone"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_email"`);
  }
}
