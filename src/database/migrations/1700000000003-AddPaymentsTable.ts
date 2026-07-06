import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsTable1700000000003 implements MigrationInterface {
  name = 'AddPaymentsTable1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Payments table (reuses existing payment_method_enum)
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "amount" decimal(10,2) NOT NULL,
        "currency" varchar(10) NOT NULL DEFAULT 'THB',
        "payment_method" "payment_method_enum" NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_payments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_payments_order_id" ON "payments" ("order_id")`);
    await queryRunner.query(`CREATE INDEX "idx_payments_status" ON "payments" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_order_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments" CASCADE`);
  }
}
