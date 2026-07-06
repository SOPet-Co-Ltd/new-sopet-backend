import { MigrationInterface, QueryRunner } from 'typeorm';

export class StoreReactivationRequests1700000000012 implements MigrationInterface {
  name = 'StoreReactivationRequests1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "store_reactivation_request_status_enum" AS ENUM(
        'pending',
        'approved',
        'rejected'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "store_reactivation_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "store_id" uuid NOT NULL,
        "submitted_by_user_id" uuid NOT NULL,
        "title" varchar(255) NOT NULL,
        "content" text NOT NULL,
        "status" "store_reactivation_request_status_enum" NOT NULL DEFAULT 'pending',
        "review_note" text,
        "reviewed_by" uuid,
        "reviewed_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_reactivation_requests_store"
          FOREIGN KEY ("store_id") REFERENCES "stores"("id"),
        CONSTRAINT "fk_store_reactivation_requests_submitter"
          FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id"),
        CONSTRAINT "fk_store_reactivation_requests_reviewer"
          FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_reactivation_requests_store"
        ON "store_reactivation_requests" ("store_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_reactivation_requests_status"
        ON "store_reactivation_requests" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_reactivation_requests_submitter"
        ON "store_reactivation_requests" ("submitted_by_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "store_reactivation_request_images" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "request_id" uuid NOT NULL,
        "image_url" varchar(500) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "fk_store_reactivation_request_images_request"
          FOREIGN KEY ("request_id") REFERENCES "store_reactivation_requests"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_store_reactivation_request_images_request"
        ON "store_reactivation_request_images" ("request_id", "sort_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "store_reactivation_request_images"`);
    await queryRunner.query(`DROP TABLE "store_reactivation_requests"`);
    await queryRunner.query(`DROP TYPE "store_reactivation_request_status_enum"`);
  }
}
