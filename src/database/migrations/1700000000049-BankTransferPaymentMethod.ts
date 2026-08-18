import { MigrationInterface, QueryRunner } from 'typeorm';

export class BankTransferPaymentMethod1700000000049 implements MigrationInterface {
  name = 'BankTransferPaymentMethod1700000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE "payment_method_enum" ADD VALUE IF NOT EXISTS 'bank_transfer';
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove enum values safely; leave bank_transfer in place.
  }
}
