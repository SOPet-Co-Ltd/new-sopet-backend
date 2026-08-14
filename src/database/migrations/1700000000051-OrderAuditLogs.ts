import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderAuditLogs1700000000051 implements MigrationInterface {
  name = 'OrderAuditLogs1700000000051';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "event_type" varchar(64) NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "actor_type" varchar(20) NOT NULL,
        "actor_id" uuid,
        "actor_label" varchar(255),
        "store_id" uuid,
        "details" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_order_audit_logs" PRIMARY KEY ("id"),
        CONSTRAINT "fk_order_audit_logs_order"
          FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_order_audit_logs_order_occurred" ON "order_audit_logs" ("order_id", "occurred_at", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_audit_logs_order_event" ON "order_audit_logs" ("order_id", "event_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_audit_logs_order_event"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_audit_logs_order_occurred"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_audit_logs"`);
  }
}
