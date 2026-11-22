import { MigrationInterface, QueryRunner } from 'typeorm';

export class SavedPaymentMethodOmiseTokenNullable1791643723000 implements MigrationInterface {
  name = 'SavedPaymentMethodOmiseTokenNullable1791643723000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ALTER COLUMN "omise_card_token" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "saved_payment_methods"
      SET "omise_card_token" = ''
      WHERE "omise_card_token" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "saved_payment_methods"
      ALTER COLUMN "omise_card_token" SET NOT NULL
    `);
  }
}
