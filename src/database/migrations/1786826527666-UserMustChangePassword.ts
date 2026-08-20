import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserMustChangePassword1786826527666 implements MigrationInterface {
  name = 'UserMustChangePassword1786826527666';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"
    `);
  }
}
