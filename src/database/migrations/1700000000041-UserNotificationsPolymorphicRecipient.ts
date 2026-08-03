import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * user_notifications.user_id stores either users.id (vendor/admin) or
 * customers.id (buyer). The FK to users blocked customer in-app notifications.
 */
export class UserNotificationsPolymorphicRecipient1700000000041 implements MigrationInterface {
  name = 'UserNotificationsPolymorphicRecipient1700000000041';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_notifications"
        DROP CONSTRAINT IF EXISTS "fk_user_notifications_user"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-adding the FK would fail if any rows reference customers.id.
    // Delete orphan (non-user) rows first, then restore the constraint.
    await queryRunner.query(`
      DELETE FROM "user_notifications" un
      WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u.id = un.user_id)
    `);
    await queryRunner.query(`
      ALTER TABLE "user_notifications"
        ADD CONSTRAINT "fk_user_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
  }
}
