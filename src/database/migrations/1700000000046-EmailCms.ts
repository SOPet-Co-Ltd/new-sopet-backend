import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  CONTENT_TEMPLATE_SEEDS,
  DEFAULT_CONTAINER_SEED,
} from '../../modules/email/email-cms.seed-data';

export class EmailCms1700000000046 implements MigrationInterface {
  name = 'EmailCms1700000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_containers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" character varying(255) NOT NULL,
        "html_shell" text NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_email_containers_is_default"
        ON "email_containers" ("is_default")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "email_content_templates" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" character varying(64) NOT NULL,
        "name" character varying(255) NOT NULL,
        "subject_template" text NOT NULL,
        "body_html" text NOT NULL,
        "text_template" text NOT NULL DEFAULT '',
        "container_id" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_email_content_templates_key" UNIQUE ("key"),
        CONSTRAINT "FK_email_content_templates_container"
          FOREIGN KEY ("container_id") REFERENCES "email_containers"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_email_content_templates_container"
        ON "email_content_templates" ("container_id")
    `);

    // Seed: exactly one default container derived from email-templates.ts layout().
    const containerResult = await queryRunner.query(
      `
      INSERT INTO "email_containers" ("name", "html_shell", "is_default")
      VALUES ($1, $2, $3)
      RETURNING "id"
    `,
      [
        DEFAULT_CONTAINER_SEED.name,
        DEFAULT_CONTAINER_SEED.htmlShell,
        DEFAULT_CONTAINER_SEED.isDefault,
      ],
    );
    const containerId = containerResult[0].id as string;

    // Seed: eight content templates derived from the current TS template functions.
    for (const seed of CONTENT_TEMPLATE_SEEDS) {
      await queryRunner.query(
        `
        INSERT INTO "email_content_templates"
          ("key", "name", "subject_template", "body_html", "text_template", "container_id", "enabled")
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT ("key") DO NOTHING
      `,
        [
          seed.key,
          seed.name,
          seed.subjectTemplate,
          seed.bodyHtml,
          seed.textTemplate,
          containerId,
          seed.enabled,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "email_content_templates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_containers"`);
  }
}
