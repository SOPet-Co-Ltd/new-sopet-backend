import { MigrationInterface, QueryRunner } from 'typeorm';

export class CategoryImageUrl1700000000019 implements MigrationInterface {
  name = 'CategoryImageUrl1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
      ADD COLUMN "image_url" VARCHAR(500) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "categories"
      DROP COLUMN "image_url"
    `);
  }
}
