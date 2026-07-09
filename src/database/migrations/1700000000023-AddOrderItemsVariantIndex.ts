import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderItemsVariantIndex1700000000023 implements MigrationInterface {
  name = 'AddOrderItemsVariantIndex1700000000023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_order_items_variant_id" ON "order_items"("variant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_order_items_variant_id"`);
  }
}
