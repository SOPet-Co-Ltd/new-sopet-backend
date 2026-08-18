/**
 * SSL options for node-postgres / TypeORM.
 * Managed Postgres hosts require encrypted connections.
 *
 * - DB_SSL=true enables TLS
 * - Production defaults to rejectUnauthorized=true (verify peer)
 * - Set DB_SSL_REJECT_UNAUTHORIZED=false only for break-glass / legacy hosts
 * - Optional DB_SSL_CA (PEM string or file path) for custom CA bundles
 * - When unset, uses the RDS global bundle baked into the image at
 *   DEFAULT_POSTGRES_CA_PATH if that file exists
 */

import { existsSync, readFileSync } from 'node:fs';

/** Path copied into the Docker image from infra/certs/rds-global-bundle.pem */
export const DEFAULT_POSTGRES_CA_PATH = '/app/certs/rds-global-bundle.pem';

export type PostgresSslOptions =
  | false
  | {
      require: true;
      rejectUnauthorized: boolean;
      ca?: string;
    };

function resolveCaPem(): string | undefined {
  const configured = process.env.DB_SSL_CA;
  if (configured) {
    return configured.includes('BEGIN CERTIFICATE') ? configured : readFileSync(configured, 'utf8');
  }

  if (existsSync(DEFAULT_POSTGRES_CA_PATH)) {
    return readFileSync(DEFAULT_POSTGRES_CA_PATH, 'utf8');
  }

  return undefined;
}

export function getPostgresSslOptions(): PostgresSslOptions {
  if (process.env.DB_SSL !== 'true') {
    return false;
  }

  const rejectUnauthorized =
    process.env.DB_SSL_REJECT_UNAUTHORIZED != null
      ? process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      : process.env.NODE_ENV === 'production';

  const ca = resolveCaPem();

  return {
    require: true,
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
}
