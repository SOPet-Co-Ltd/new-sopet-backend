import { createHash } from 'node:crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hash unused password-reset and email-verify tokens at rest (SOPET-H-02).
 * Column is already varchar(64); SHA-256 hex fits. Emails already sent keep working
 * because lookups hash the presented plaintext before query.
 */
export class HashAuthTokensAtRest1700000000052 implements MigrationInterface {
  name = 'HashAuthTokensAtRest1700000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.hashUnusedTokens(queryRunner, 'password_reset_tokens');
    await this.hashUnusedTokens(queryRunner, 'email_verification_tokens');
  }

  public async down(): Promise<void> {
    // Irreversible: digests cannot be un-hashed. Unused tokens remain hashed;
    // users can request a new reset / verification email.
  }

  private async hashUnusedTokens(queryRunner: QueryRunner, table: string): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT id, token FROM "${table}" WHERE used_at IS NULL`,
    )) as Array<{ id: string; token: string }>;

    for (const row of rows) {
      const digest = createHash('sha256').update(row.token).digest('hex');
      await queryRunner.query(
        `UPDATE "${table}" SET token = $1 WHERE id = $2 AND used_at IS NULL`,
        [digest, row.id],
      );
    }
  }
}
