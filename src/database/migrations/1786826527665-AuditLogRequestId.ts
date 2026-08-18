import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditLogRequestId1786826527665 implements MigrationInterface {
  name = 'AuditLogRequestId1786826527665';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN IF NOT EXISTS "request_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_audit_logs_request_id"
        ON "audit_logs" ("request_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_logs_request_id"`);
    await queryRunner.query(`
      ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "request_id"
    `);
  }
}
