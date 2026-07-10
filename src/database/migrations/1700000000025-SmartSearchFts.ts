import { MigrationInterface, QueryRunner } from 'typeorm';

const DEFAULT_RANKING_WEIGHTS = {
  text: 40,
  prefixBoost: 15,
  soldCount: 20,
  averageRating: 15,
  reviewCount: 10,
  personalizationCap: 0.1,
  trigramFallbackThreshold: 5,
  trigramMinSimilarity: 0.3,
  rrfK: 60,
};

export class SmartSearchFts1700000000025 implements MigrationInterface {
  name = 'SmartSearchFts1700000000025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION sopet_search_ts_config()
      RETURNS regconfig AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'thai') THEN
          RETURN 'thai'::regconfig;
        END IF;
        RETURN 'simple'::regconfig;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_product_search_vector()
      RETURNS trigger AS $$
      DECLARE
        ts_cfg regconfig;
        brand_text text := '';
        pet_type_text text := '';
        category_text text := '';
        taxonomy_text text := '';
      BEGIN
        ts_cfg := sopet_search_ts_config();

        IF NEW.brand_id IS NOT NULL THEN
          SELECT coalesce(b.name, '') INTO brand_text FROM brands b WHERE b.id = NEW.brand_id;
        END IF;

        IF NEW.pet_type_id IS NOT NULL THEN
          SELECT coalesce(pt.name, '') INTO pet_type_text FROM pet_types pt WHERE pt.id = NEW.pet_type_id;
        END IF;

        IF NEW.category_id IS NOT NULL THEN
          SELECT coalesce(c.name, '') INTO category_text FROM categories c WHERE c.id = NEW.category_id;
        END IF;

        SELECT coalesce(string_agg(t.name, ' '), '') INTO taxonomy_text
        FROM product_tags pt
        INNER JOIN tags t ON t.id = pt.tag_id
        WHERE pt.product_id = NEW.id;

        IF taxonomy_text IS NULL THEN
          taxonomy_text := '';
        END IF;

        NEW.search_vector :=
          setweight(to_tsvector(ts_cfg, coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector(ts_cfg, coalesce(NEW.description, '')), 'B') ||
          setweight(
            to_tsvector(ts_cfg, trim(coalesce(brand_text, '') || ' ' || coalesce(pet_type_text, ''))),
            'B'
          ) ||
          setweight(
            to_tsvector(
              ts_cfg,
              trim(
                coalesce(array_to_string(NEW.tags, ' '), '') || ' ' ||
                coalesce(taxonomy_text, '') || ' ' ||
                coalesce(category_text, '')
              )
            ),
            'C'
          );

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      UPDATE products
      SET name = name
      WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_synonyms (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        terms text[] NOT NULL,
        expansion text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query text NOT NULL,
        result_count integer NOT NULL DEFAULT 0,
        latency_ms integer NOT NULL DEFAULT 0,
        filters jsonb NOT NULL DEFAULT '{}'::jsonb,
        session_id varchar(64),
        user_id uuid,
        suggestion_clicked boolean NOT NULL DEFAULT false,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_search_events_created_at ON search_events(created_at);
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS search_suggestion_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        query_prefix text NOT NULL,
        suggestion_query text,
        product_id uuid,
        session_id varchar(64),
        clicked boolean NOT NULL DEFAULT false,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_search_profiles (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        recent_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
        recent_product_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(
      `
      INSERT INTO settings (key, value, description)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (key) DO NOTHING
    `,
      [
        'search.ranking_weights',
        JSON.stringify(DEFAULT_RANKING_WEIGHTS),
        'Smart Search ranking weight configuration',
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM settings WHERE key = 'search.ranking_weights'`);

    await queryRunner.query(`DROP TABLE IF EXISTS user_search_profiles`);
    await queryRunner.query(`DROP TABLE IF EXISTS search_suggestion_events`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_search_events_created_at`);
    await queryRunner.query(`DROP TABLE IF EXISTS search_events`);
    await queryRunner.query(`DROP TABLE IF EXISTS search_synonyms`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_product_search_vector()
      RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
          setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B') ||
          setweight(to_tsvector('simple', array_to_string(NEW.tags, ' ')), 'C');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`DROP FUNCTION IF EXISTS sopet_search_ts_config()`);
  }
}
