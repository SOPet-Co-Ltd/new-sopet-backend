import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerDeletionRequestedAt1700000000018 implements MigrationInterface {
  name = 'CustomerDeletionRequestedAt1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN "deletion_requested_at" TIMESTAMP NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      DROP COLUMN "deletion_requested_at"
    `);
  }
}
