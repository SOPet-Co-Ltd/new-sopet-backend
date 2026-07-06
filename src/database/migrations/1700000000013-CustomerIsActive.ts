import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerIsActive1700000000013 implements MigrationInterface {
  name = 'CustomerIsActive1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN "is_active" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      DROP COLUMN "is_active"
    `);
  }
}
