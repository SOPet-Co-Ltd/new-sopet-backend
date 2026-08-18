import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPostgresSslOptions } from './postgres-ssl.util';

describe('getPostgresSslOptions', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns false when DB_SSL is not true', () => {
    process.env.DB_SSL = 'false';
    process.env.DB_HOST = 'localhost';
    expect(getPostgresSslOptions()).toBe(false);
  });

  it('verifies peers in production by default', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_HOST = 'localhost';
    process.env.NODE_ENV = 'production';
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    delete process.env.DB_SSL_CA;
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: true,
    });
  });

  it('allows break-glass disable of verification', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_HOST = 'localhost';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    delete process.env.DB_SSL_CA;
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: false,
    });
  });

  it('loads an inline PEM from DB_SSL_CA', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nINLINE\n-----END CERTIFICATE-----';
    process.env.DB_SSL = 'true';
    process.env.DB_HOST = 'localhost';
    process.env.NODE_ENV = 'production';
    process.env.DB_SSL_CA = ca;
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: true,
      ca,
    });
  });

  it('loads a CA bundle from a file path', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nFILE\n-----END CERTIFICATE-----';
    const dir = mkdtempSync(join(tmpdir(), 'sopet-rds-ca-'));
    const caPath = join(dir, 'rds-ca.pem');
    writeFileSync(caPath, ca);

    process.env.DB_SSL = 'true';
    process.env.DB_HOST = 'localhost';
    process.env.NODE_ENV = 'production';
    process.env.DB_SSL_CA = caPath;
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: true,
      ca,
    });
  });

  it('encrypts Crunchy Bridge without the Amazon RDS trust store', () => {
    process.env.DB_SSL = 'true';
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = 'p.example.db.postgresbridge.com';
    process.env.DB_SSL_CA = '/runner/work/repo/infra/certs/rds-global-bundle.pem';
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: false,
    });
  });

  it('verifies Crunchy Bridge when a team CA is supplied', () => {
    const ca = '-----BEGIN CERTIFICATE-----\nCRUNCHY TEAM\n-----END CERTIFICATE-----';
    process.env.DB_SSL = 'true';
    process.env.NODE_ENV = 'production';
    process.env.DB_HOST = 'p.example.db.postgresbridge.com';
    process.env.DB_SSL_CA = ca;
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;

    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: true,
      ca,
    });
  });

  it('keeps the vendored Amazon RDS CA bundle as PEM', () => {
    const pem = readFileSync(join(__dirname, '../../infra/certs/rds-global-bundle.pem'), 'utf8');
    expect(pem).toContain('BEGIN CERTIFICATE');
  });
});
