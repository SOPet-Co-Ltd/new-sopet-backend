import { DataSource } from 'typeorm';
import { createTypeOrmTestOptions } from './typeorm-test.config';

export interface PostgresConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

/** Returns true when PostgreSQL accepts a connection with the configured test credentials. */
export async function isPostgresAvailable(
  overrides: PostgresConnectionOptions = {},
): Promise<boolean> {
  const baseOptions = createTypeOrmTestOptions();
  const dataSource = new DataSource({
    ...baseOptions,
    ...(overrides.host !== undefined ? { host: overrides.host } : {}),
    ...(overrides.port !== undefined ? { port: overrides.port } : {}),
    ...(overrides.user !== undefined ? { username: overrides.user } : {}),
    ...(overrides.password !== undefined ? { password: overrides.password } : {}),
    ...(overrides.database !== undefined ? { database: overrides.database } : {}),
  });

  try {
    await dataSource.initialize();
    await dataSource.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}
