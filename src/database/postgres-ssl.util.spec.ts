import { getPostgresSslOptions } from './postgres-ssl.util';

describe('getPostgresSslOptions', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('returns false when DB_SSL is not true', () => {
    process.env.DB_SSL = 'false';
    expect(getPostgresSslOptions()).toBe(false);
  });

  it('verifies peers in production by default', () => {
    process.env.DB_SSL = 'true';
    process.env.NODE_ENV = 'production';
    delete process.env.DB_SSL_REJECT_UNAUTHORIZED;
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: true,
    });
  });

  it('allows break-glass disable of verification', () => {
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    expect(getPostgresSslOptions()).toEqual({
      require: true,
      rejectUnauthorized: false,
    });
  });
});
