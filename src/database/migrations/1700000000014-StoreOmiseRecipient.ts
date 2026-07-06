import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreOmiseRecipient1700000000014 implements MigrationInterface {
  name = 'StoreOmiseRecipient1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "store_omise_recipient_status_enum" AS ENUM('not_connected', 'pending', 'active', 'failed')
    `);

    await queryRunner.query(`
      ALTER TABLE "stores"
        ADD COLUMN IF NOT EXISTS "bank_code" varchar(20),
        ADD COLUMN IF NOT EXISTS "omise_recipient_id" varchar(255),
        ADD COLUMN IF NOT EXISTS "omise_recipient_status" "store_omise_recipient_status_enum" NOT NULL DEFAULT 'not_connected',
        ADD COLUMN IF NOT EXISTS "omise_recipient_failure_message" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "stores"
        DROP COLUMN IF EXISTS "omise_recipient_failure_message",
        DROP COLUMN IF EXISTS "omise_recipient_status",
        DROP COLUMN IF EXISTS "omise_recipient_id",
        DROP COLUMN IF EXISTS "bank_code"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "store_omise_recipient_status_enum"`);
  }
}
