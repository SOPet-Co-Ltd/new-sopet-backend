import { MigrationInterface, QueryRunner } from 'typeorm';

const EMBEDDING_DIMENSION = 1536;

/**
 * Smart Search Phase 3 — pgvector extension + product_embeddings table.
 * Probes pg_available_extensions; skips vector DDL when unavailable (e.g. postgres:15-alpine).
 */
export class SmartSearchEmbeddings1700000000027 implements MigrationInterface {
  name = 'SmartSearchEmbeddings1700000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const availability = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
      ) AS vector_available
    `);
    const vectorAvailable = availability?.[0]?.vector_available === true;

    if (!vectorAvailable) {
      await queryRunner.query(`
        DO $$
        BEGIN
          RAISE NOTICE 'Smart Search: pgvector extension not available — semantic leg disabled until DB image includes vector.';
        END $$;
      `);
      return;
    }

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS product_embeddings (
        product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        embedding vector(${EMBEDDING_DIMENSION}) NOT NULL,
        model_version varchar(64) NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_product_embeddings_hnsw
      ON product_embeddings
      USING hnsw (embedding vector_cosine_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_product_embeddings_hnsw`);
    await queryRunner.query(`DROP TABLE IF EXISTS product_embeddings`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
