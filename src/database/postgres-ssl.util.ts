/**
 * SSL options for node-postgres / TypeORM.
 * Managed Postgres hosts require encrypted connections.
 *
 * - DB_SSL=true enables TLS
 * - Production defaults to rejectUnauthorized=true (verify peer)
 * - Set DB_SSL_REJECT_UNAUTHORIZED=false only for break-glass / legacy hosts
 * - Optional DB_SSL_CA (PEM) for custom CA bundles
 */

import { readFileSync } from 'node:fs';

export type PostgresSslOptions =
  | false
  | {
      require: true;
      rejectUnauthorized: boolean;
      ca?: string;
    };

export function getPostgresSslOptions(): PostgresSslOptions {
  if (process.env.DB_SSL !== 'true') {
    return false;
  }

  const rejectUnauthorized =
    process.env.DB_SSL_REJECT_UNAUTHORIZED != null
      ? process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      : process.env.NODE_ENV === 'production';

  let ca: string | undefined;
  if (process.env.DB_SSL_CA) {
    ca = process.env.DB_SSL_CA.includes('BEGIN CERTIFICATE')
      ? process.env.DB_SSL_CA
      : readFileSync(process.env.DB_SSL_CA, 'utf8');
  }

  return {
    require: true,
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
}
