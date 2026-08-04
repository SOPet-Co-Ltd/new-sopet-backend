import { config } from 'dotenv';
import { execSync } from 'child_process';
import { createDataSource } from './helpers';
import { dropApplicationSchema } from './drop-application-schema';
import { assertDatabaseResetAllowed } from './guards';

config();

/**
 * Drop all tables and re-apply migrations. Does not seed data.
 */
export async function runDatabaseReset(): Promise<void> {
  assertDatabaseResetAllowed('database reset');

  const dataSource = await createDataSource();

  try {
    console.log('Dropping application schema (tables, enums, routines)...');
    await dropApplicationSchema(dataSource);
  } finally {
    await dataSource.destroy();
  }

  console.log('Running migrations...');
  execSync('yarn migration:run', { stdio: 'inherit' });

  console.log('\nDatabase reset complete (schema dropped, migrations applied, no seed data).');
}

if (require.main === module) {
  runDatabaseReset().catch((error) => {
    console.error('Database reset failed:', error);
    process.exit(1);
  });
}
