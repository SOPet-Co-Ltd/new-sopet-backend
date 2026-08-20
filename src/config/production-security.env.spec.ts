import {
  BANK_DATA_ENCRYPTION_KEY_REQUIRED,
  GRAPHQL_PLAYGROUND_FORBIDDEN,
  HEALTH_CHECK_TOKEN_REQUIRED,
  NODE_ENV_REQUIRED,
  SMS_OTP_LOG_ONLY_FORBIDDEN,
  validateProductionSecurityEnv,
} from './production-security.env';

describe('validateProductionSecurityEnv', () => {
  const validProd: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    BANK_DATA_ENCRYPTION_KEY: 'long-random-secret',
    SMS_OTP_LOG_ONLY: 'false',
    HEALTH_CHECK_TOKEN: 'health-secret',
    GRAPHQL_PLAYGROUND: 'false',
  };

  it('no-ops outside production when NODE_ENV is set', () => {
    expect(() =>
      validateProductionSecurityEnv({
        NODE_ENV: 'development',
        SMS_OTP_LOG_ONLY: 'true',
        GRAPHQL_PLAYGROUND: 'true',
      }),
    ).not.toThrow();
  });

  it('passes when all production secrets are set', () => {
    expect(() => validateProductionSecurityEnv(validProd)).not.toThrow();
  });

  it('fails when BANK_DATA_ENCRYPTION_KEY is unset', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        BANK_DATA_ENCRYPTION_KEY: '',
      }),
    ).toThrow(BANK_DATA_ENCRYPTION_KEY_REQUIRED);
  });

  it('rejects SMS_OTP_LOG_ONLY=true in production', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        SMS_OTP_LOG_ONLY: 'true',
      }),
    ).toThrow(SMS_OTP_LOG_ONLY_FORBIDDEN);
  });

  it('passes when Redis is unset (optional)', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        REDIS_HOST: '',
        REDIS_PASSWORD: '',
      }),
    ).not.toThrow();
  });

  it('allows REDIS_HOST without REDIS_PASSWORD (password optional)', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        REDIS_HOST: 'redis.example.com',
        REDIS_PASSWORD: '',
      }),
    ).not.toThrow();
  });

  it('requires HEALTH_CHECK_TOKEN in production', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        HEALTH_CHECK_TOKEN: '',
      }),
    ).toThrow(HEALTH_CHECK_TOKEN_REQUIRED);
  });

  it('rejects GRAPHQL_PLAYGROUND=true in production', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        GRAPHQL_PLAYGROUND: 'true',
      }),
    ).toThrow(GRAPHQL_PLAYGROUND_FORBIDDEN);
  });

  it('fails when NODE_ENV is unset', () => {
    expect(() =>
      validateProductionSecurityEnv({
        BANK_DATA_ENCRYPTION_KEY: 'x',
      }),
    ).toThrow(NODE_ENV_REQUIRED);
  });

  it('allows unset NODE_ENV only with ALLOW_UNSET_NODE_ENV=true', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ALLOW_UNSET_NODE_ENV: 'true',
        SMS_OTP_LOG_ONLY: 'true',
      }),
    ).not.toThrow();
  });
});
