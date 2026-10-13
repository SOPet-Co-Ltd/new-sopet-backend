import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVariantOptionsToReview1791643722706 implements MigrationInterface {
  name = 'AddVariantOptionsToReview1791643722706';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reviews" ADD "variant_options" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reviews" DROP COLUMN "variant_options"`);
  }
}
