import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerOmiseCustomerId1700000000030 implements MigrationInterface {
  name = 'CustomerOmiseCustomerId1700000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "omise_customer_id" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"
      DROP COLUMN IF EXISTS "omise_customer_id"
    `);
  }
}
