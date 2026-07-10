import { MigrationInterface, QueryRunner } from 'typeorm';

export class SmartSearchTrigram1700000000026 implements MigrationInterface {
  name = 'SmartSearchTrigram1700000000026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_name_trgm
      ON products
      USING gin (name gin_trgm_ops)
      WHERE status = 'published' AND deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_trgm`);
  }
}
