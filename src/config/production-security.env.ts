import { Logger } from '@nestjs/common';

const logger = new Logger('ProductionSecurityEnv');

export const BANK_DATA_ENCRYPTION_KEY_REQUIRED = 'BANK_DATA_ENCRYPTION_KEY_REQUIRED';
export const SMS_OTP_LOG_ONLY_FORBIDDEN = 'SMS_OTP_LOG_ONLY_FORBIDDEN_IN_PRODUCTION';
export const REDIS_PASSWORD_REQUIRED = 'REDIS_PASSWORD_REQUIRED';

/**
 * Fail-fast production env checks (INF-010 / INF-011 / INF-012).
 * Safe to call from config factories — no-ops when NODE_ENV !== production.
 */
export function validateProductionSecurityEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (!env.BANK_DATA_ENCRYPTION_KEY?.trim()) {
    logger.error(BANK_DATA_ENCRYPTION_KEY_REQUIRED);
    throw new Error(BANK_DATA_ENCRYPTION_KEY_REQUIRED);
  }

  if (env.SMS_OTP_LOG_ONLY === 'true') {
    logger.error(SMS_OTP_LOG_ONLY_FORBIDDEN);
    throw new Error(SMS_OTP_LOG_ONLY_FORBIDDEN);
  }

  if (!env.REDIS_PASSWORD?.trim()) {
    logger.error(REDIS_PASSWORD_REQUIRED);
    throw new Error(REDIS_PASSWORD_REQUIRED);
  }
}
