import { MigrationInterface, QueryRunner } from 'typeorm';

export class PayoutSettlementRail1700000000050 implements MigrationInterface {
  name = 'PayoutSettlementRail1700000000050';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "payout_settlement_rail_enum" AS ENUM ('omise', 'manual');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "payouts"
      ADD COLUMN IF NOT EXISTS "settlement_rail" "payout_settlement_rail_enum" NOT NULL DEFAULT 'omise'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payouts_store_rail_status"
      ON "payouts" ("store_id", "settlement_rail", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payouts_store_rail_status"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP COLUMN IF EXISTS "settlement_rail"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_settlement_rail_enum"`);
  }
}
