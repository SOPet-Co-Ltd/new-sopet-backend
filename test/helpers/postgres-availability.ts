import net from 'node:net';
import { DataSource } from 'typeorm';
import { createTypeOrmTestOptions } from './typeorm-test.config';

export interface PostgresConnectionOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 1500;

function canTcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Returns true when PostgreSQL accepts a connection with the configured test credentials. */
export async function isPostgresAvailable(
  overrides: PostgresConnectionOptions = {},
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const baseOptions = createTypeOrmTestOptions();
  const host =
    overrides.host ?? (typeof baseOptions.host === 'string' ? baseOptions.host : 'localhost');
  const port = overrides.port ?? (typeof baseOptions.port === 'number' ? baseOptions.port : 5432);

  // Fail fast on refused/unreachable hosts — avoids hanging TypeORM initialize (open handles).
  if (!(await canTcpConnect(host, port, timeoutMs))) {
    return false;
  }

  const dataSource = new DataSource({
    ...baseOptions,
    ...(overrides.host !== undefined ? { host: overrides.host } : {}),
    ...(overrides.port !== undefined ? { port: overrides.port } : {}),
    ...(overrides.user !== undefined ? { username: overrides.user } : {}),
    ...(overrides.password !== undefined ? { password: overrides.password } : {}),
    ...(overrides.database !== undefined ? { database: overrides.database } : {}),
    connectTimeoutMS: timeoutMs,
    extra: {
      ...(typeof baseOptions.extra === 'object' && baseOptions.extra !== null
        ? baseOptions.extra
        : {}),
      connectionTimeoutMillis: timeoutMs,
    },
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
