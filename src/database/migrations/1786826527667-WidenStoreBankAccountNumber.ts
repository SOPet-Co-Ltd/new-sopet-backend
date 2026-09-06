import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenStoreBankAccountNumber1786826527667 implements MigrationInterface {
  name = 'WidenStoreBankAccountNumber1786826527667';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // AES-GCM ciphertext (enc:v1:…) is ~61–67 chars; varchar(50) rejected saves.
    await queryRunner.query(`
      ALTER TABLE "stores"
        ALTER COLUMN "bank_account_number" TYPE character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ max_len }] = (await queryRunner.query(`
      SELECT COALESCE(MAX(length("bank_account_number")), 0) AS max_len
      FROM "stores"
    `)) as Array<{ max_len: string | number }>;

    if (Number(max_len) > 50) {
      // Truncating ciphertext would corrupt encrypted values — skip narrowing.
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "stores"
        ALTER COLUMN "bank_account_number" TYPE character varying(50)
    `);
  }
}
