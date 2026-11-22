import { MigrationInterface, QueryRunner } from 'typeorm';

export class TrueMoneyShopeePayPaymentMethod1700000000057 implements MigrationInterface {
  name = 'TrueMoneyShopeePayPaymentMethod1700000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "payment_method_enum" ADD VALUE IF NOT EXISTS 'truemoney';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "payment_method_enum" ADD VALUE IF NOT EXISTS 'shopeepay';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove enum values safely; leave truemoney/shopeepay in place.
  }
}
