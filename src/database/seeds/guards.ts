const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

// Hostnames used by common local dev setups (OrbStack, Docker Desktop, mDNS).
const LOCAL_HOST_PATTERNS = [
  /\.orb\.local$/, // OrbStack (e.g. postgres.sopet-backend.orb.local)
  /(^|\.)docker\.internal$/, // Docker Desktop (host.docker.internal, *.docker.internal)
  /\.local$/, // mDNS / *.local dev hostnames
  /\.localhost$/,
];

// Hostnames that clearly point at managed/production databases. These always
// block a reset regardless of any allowlist match.
const PRODUCTION_HOST_PATTERNS = [
  /\.rds\.amazonaws\.com$/, // AWS RDS
  /\.amazonaws\.com$/, // AWS (Aurora, etc.)
  /\.supabase\.co$/, // Supabase cloud
  /\.supabase\.com$/,
  /\.pooler\.supabase\.com$/,
  /\.neon\.tech$/, // Neon
  /\.psdb\.cloud$/, // PlanetScale
  /\.planetscale\./, // PlanetScale
  /\.cockroachlabs\.cloud$/, // CockroachDB Cloud
  /\.aivencloud\.com$/, // Aiven
  /\.render\.com$/, // Render
  /\.railway\.app$/, // Railway
  /\.azure\.com$/, // Azure
  /\.digitalocean\.com$/, // DigitalOcean
];

const TRUTHY_OVERRIDE = new Set(['1', 'true', 'yes']);

function resetOverrideEnabled(): boolean {
  const values = [process.env.DB_RESET_ALLOW, process.env.ALLOW_DB_RESET];
  return values.some((value) => value != null && TRUTHY_OVERRIDE.has(value.trim().toLowerCase()));
}

function extractHosts(): string[] {
  const hosts: string[] = [];

  const dbHost = process.env.DB_HOST?.trim().toLowerCase();
  if (dbHost) {
    hosts.push(dbHost);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    try {
      const parsed = new URL(databaseUrl);
      if (parsed.hostname) {
        hosts.push(parsed.hostname.toLowerCase());
      }
    } catch {
      // Malformed URL — ignore and fall back to DB_HOST / default.
    }
  }

  if (hosts.length === 0) {
    hosts.push('localhost');
  }

  return hosts;
}

function isLocalHost(host: string): boolean {
  if (LOCAL_DB_HOSTS.has(host)) {
    return true;
  }
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function isProductionHost(host: string): boolean {
  return PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Blocks destructive local-only operations (schema drop, full reset) on
 * production-like environments.
 *
 * Allowed: localhost / 127.0.0.1 / ::1, *.orb.local (OrbStack),
 * *.docker.internal (Docker Desktop), and *.local dev hostnames.
 * Blocked: NODE_ENV=production and managed/cloud database hosts (RDS/Aurora,
 * Supabase, Neon, PlanetScale, etc.).
 *
 * Set DB_RESET_ALLOW=1 (or ALLOW_DB_RESET=true) to override the host check for
 * unrecognized local hosts. This does not override the NODE_ENV=production or
 * production-host guards.
 */
export function assertLocalDevOnly(operation: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `Refusing ${operation}: NODE_ENV is "production". ` +
        'Database reset is only allowed in local development.',
    );
  }

  const hosts = extractHosts();

  const productionHost = hosts.find(isProductionHost);
  if (productionHost) {
    throw new Error(
      `Refusing ${operation}: host "${productionHost}" looks like a managed/production database. ` +
        'Database reset is only allowed in local development.',
    );
  }

  if (resetOverrideEnabled()) {
    return;
  }

  if (!hosts.every(isLocalHost)) {
    const host = process.env.DB_HOST || hosts[0];
    throw new Error(
      `Refusing ${operation}: DB_HOST "${host}" does not look like a local database. ` +
        'Point DB_HOST at a local host (localhost, *.orb.local, *.docker.internal) ' +
        'or set DB_RESET_ALLOW=1 to override.',
    );
  }
}
