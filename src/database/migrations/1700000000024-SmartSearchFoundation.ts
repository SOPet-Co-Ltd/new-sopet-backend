import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Smart Search foundation — extension enablement and Thai FTS config probe.
 *
 * Probe (run manually after migration):
 *   SELECT to_tsvector('thai', 'อาหารแมว');
 *
 * Expected when 'thai' is available: non-null tsvector (e.g. 'แมว':2 'อาหาร':1).
 * Fallback if probe fails on postgres:15-alpine:
 *   - Document in deployment runbook; Phase 1 trigger may use 'simple' + pg_trgm until
 *     a Postgres image with Thai dictionaries is provisioned (e.g. full Debian PG image).
 *
 * Extensions (Phase 0):
 *   - pg_trgm: typo tolerance (Phase 2)
 *
 * Deferred to Phase 3 migration (requires pgvector-capable Postgres image):
 *   - vector: pgvector semantic leg, dimension N=1536 per ADR-0002
 */
export class SmartSearchFoundation1700000000024 implements MigrationInterface {
  name = 'SmartSearchFoundation1700000000024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // pgvector (CREATE EXTENSION vector) is applied in Phase 3 when the DB image
    // includes pgvector — stock postgres:15-alpine does not ship vector.control.

    // Probe Thai text search configuration (informational — does not abort migration).
    const thaiProbe = await queryRunner.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_ts_config WHERE cfgname = 'thai'
       ) AS thai_config_available`,
    );
    const thaiAvailable = thaiProbe?.[0]?.thai_config_available === true;

    if (thaiAvailable) {
      await queryRunner.query(`SELECT to_tsvector('thai', 'อาหารแมว') AS thai_probe_sample`);
    } else {
      await queryRunner.query(`
        DO $$
        BEGIN
          RAISE NOTICE 'Smart Search: pg_ts_config ''thai'' not found — Phase 1 trigger must use documented fallback (simple + pg_trgm) until Thai dictionaries are installed.';
        END $$;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm`);
  }
}
