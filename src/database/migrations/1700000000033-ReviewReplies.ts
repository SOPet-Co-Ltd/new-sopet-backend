import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReviewReplies1700000000033 implements MigrationInterface {
  name = 'ReviewReplies1700000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "review_replies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "body" text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_replies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_review_replies_review_id" UNIQUE ("review_id"),
        CONSTRAINT "fk_review_replies_review" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "review_replies" CASCADE`);
  }
}
