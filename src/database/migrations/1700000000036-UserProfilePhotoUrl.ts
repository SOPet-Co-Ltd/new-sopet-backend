import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserProfilePhotoUrl1700000000036 implements MigrationInterface {
  name = 'UserProfilePhotoUrl1700000000036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "profile_photo_url" character varying(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "profile_photo_url"
    `);
  }
}
