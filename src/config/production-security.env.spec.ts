import {
  BANK_DATA_ENCRYPTION_KEY_REQUIRED,
  REDIS_PASSWORD_REQUIRED,
  SMS_OTP_LOG_ONLY_FORBIDDEN,
  validateProductionSecurityEnv,
} from './production-security.env';

describe('validateProductionSecurityEnv', () => {
  const validProd: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    BANK_DATA_ENCRYPTION_KEY: 'long-random-secret',
    SMS_OTP_LOG_ONLY: 'false',
    REDIS_PASSWORD: 'redis-secret',
  };

  it('no-ops outside production', () => {
    expect(() =>
      validateProductionSecurityEnv({
        NODE_ENV: 'development',
        SMS_OTP_LOG_ONLY: 'true',
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

  it('requires REDIS_PASSWORD in production', () => {
    expect(() =>
      validateProductionSecurityEnv({
        ...validProd,
        REDIS_PASSWORD: '',
      }),
    ).toThrow(REDIS_PASSWORD_REQUIRED);
  });
});
