import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogs1700000000037 implements MigrationInterface {
  name = 'AuditLogs1700000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actor_type" varchar(20) NOT NULL,
        "actor_id" uuid,
        "actor_label" varchar(255),
        "action" varchar(100) NOT NULL,
        "resource_type" varchar(50) NOT NULL,
        "resource_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "ip_address" varchar(45),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs" ("created_at" DESC)`,
    );
    await queryRunner.query(`CREATE INDEX "idx_audit_logs_action" ON "audit_logs" ("action")`);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_resource" ON "audit_logs" ("resource_type", "resource_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" ("actor_type", "actor_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_actor"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_resource"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_created_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
