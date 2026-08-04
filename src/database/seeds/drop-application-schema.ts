import { DataSource } from 'typeorm';

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Drop application-owned objects in public schema without touching
 * extension-owned views (e.g. pg_stat_statements on managed Postgres).
 */
export async function dropApplicationSchema(dataSource: DataSource): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    const tables: Array<{ tablename: string }> = await queryRunner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    for (const { tablename } of tables) {
      await queryRunner.query(`DROP TABLE IF EXISTS public.${quoteIdent(tablename)} CASCADE`);
    }

    const enums: Array<{ typname: string }> = await queryRunner.query(
      `SELECT t.typname
       FROM pg_type t
       JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = 'public' AND t.typtype = 'e'`,
    );
    for (const { typname } of enums) {
      await queryRunner.query(`DROP TYPE IF EXISTS public.${quoteIdent(typname)} CASCADE`);
    }

    const routines: Array<{ signature: string }> = await queryRunner.query(
      `SELECT p.oid::regprocedure::text AS signature
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prokind IN ('f', 'p')
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
           WHERE d.objid = p.oid AND d.deptype = 'e'
         )`,
    );
    for (const { signature } of routines) {
      await queryRunner.query(`DROP ROUTINE IF EXISTS ${signature} CASCADE`);
    }
  } finally {
    await queryRunner.release();
  }
}
