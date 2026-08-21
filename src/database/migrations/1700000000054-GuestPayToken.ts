import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SOPET-H-07: hashed guest pay token (+ expiry) on orders.
 * Legacy unpaid guest rows keep null hash (UUID path) until they pay or expire.
 */
export class GuestPayToken1700000000054 implements MigrationInterface {
  name = 'GuestPayToken1700000000054';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN "guest_pay_token_hash" character varying(64),
      ADD COLUMN "guest_pay_token_expires_at" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "guest_pay_token_expires_at",
      DROP COLUMN IF EXISTS "guest_pay_token_hash"
    `);
  }
}
