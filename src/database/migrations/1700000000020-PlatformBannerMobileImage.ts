import { MigrationInterface, QueryRunner } from 'typeorm';

export class PlatformBannerMobileImage1700000000020 implements MigrationInterface {
  name = 'PlatformBannerMobileImage1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_banners"
      ADD COLUMN "mobile_image_url" VARCHAR(500) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "platform_banners"
      DROP COLUMN "mobile_image_url"
    `);
  }
}
