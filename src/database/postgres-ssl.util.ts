/**
 * SSL options for node-postgres / TypeORM.
 * Managed Postgres hosts require encrypted connections.
 *
 * - DB_SSL=true enables TLS
 * - Amazon RDS: verify the peer with infra/certs/rds-global-bundle.pem
 * - Crunchy Bridge (*.postgresbridge.com): team-private self-signed root.
 *   Encrypt always; do not verify unless a team CA is supplied via DB_SSL_CA.
 *   The RDS bundle is the wrong trust store and causes SELF_SIGNED_CERT_IN_CHAIN.
 * - Production defaults to rejectUnauthorized=true for other hosts
 * - Set DB_SSL_REJECT_UNAUTHORIZED=false only for break-glass / legacy hosts
 * - Optional DB_SSL_CA (PEM string or file path) for custom CA bundles
 */

import { existsSync, readFileSync } from 'node:fs';

/** Path copied into the Docker image from infra/certs/rds-global-bundle.pem */
export const DEFAULT_POSTGRES_CA_PATH = '/app/certs/rds-global-bundle.pem';

const POSTGRES_BRIDGE_HOST_PATTERN = /\.postgresbridge\.com$/i;
const RDS_HOST_PATTERN = /\.rds\.amazonaws\.com$/i;
const RDS_BUNDLE_PATH_PATTERN = /rds-global-bundle\.pem$/i;

export type PostgresSslOptions =
  | false
  | {
      require: true;
      rejectUnauthorized: boolean;
      ca?: string;
    };

function isPostgresBridgeHost(host = process.env.DB_HOST): boolean {
  return POSTGRES_BRIDGE_HOST_PATTERN.test(host ?? '');
}

function isRdsHost(host = process.env.DB_HOST): boolean {
  return RDS_HOST_PATTERN.test(host ?? '');
}

function isRdsBundlePath(value: string): boolean {
  return RDS_BUNDLE_PATH_PATTERN.test(value);
}

function readCaValue(configured: string): string {
  return configured.includes('BEGIN CERTIFICATE') ? configured : readFileSync(configured, 'utf8');
}

function resolveCaPem(): string | undefined {
  const host = process.env.DB_HOST ?? '';
  const configured = process.env.DB_SSL_CA;

  if (isPostgresBridgeHost(host)) {
    if (!configured || isRdsBundlePath(configured)) {
      return undefined;
    }
    return readCaValue(configured);
  }

  if (configured) {
    return readCaValue(configured);
  }

  if (isRdsHost(host) && existsSync(DEFAULT_POSTGRES_CA_PATH)) {
    return readFileSync(DEFAULT_POSTGRES_CA_PATH, 'utf8');
  }

  return undefined;
}

export function getPostgresSslOptions(): PostgresSslOptions {
  if (process.env.DB_SSL !== 'true') {
    return false;
  }

  const ca = resolveCaPem();
  const host = process.env.DB_HOST ?? '';

  let rejectUnauthorized: boolean;
  if (process.env.DB_SSL_REJECT_UNAUTHORIZED != null) {
    rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  } else if (ca) {
    rejectUnauthorized = true;
  } else if (isPostgresBridgeHost(host)) {
    rejectUnauthorized = false;
  } else {
    rejectUnauthorized = process.env.NODE_ENV === 'production';
  }

  return {
    require: true,
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
}
