import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentsOmiseChargeId1700000000039 implements MigrationInterface {
  name = 'AddPaymentsOmiseChargeId1700000000039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN "omise_charge_id" varchar(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "omise_charge_id"
    `);
  }
}
