import { Logger } from '@nestjs/common';

const logger = new Logger('ProductionSecurityEnv');

export const BANK_DATA_ENCRYPTION_KEY_REQUIRED = 'BANK_DATA_ENCRYPTION_KEY_REQUIRED';
export const SMS_OTP_LOG_ONLY_FORBIDDEN = 'SMS_OTP_LOG_ONLY_FORBIDDEN_IN_PRODUCTION';
export const NODE_ENV_REQUIRED = 'NODE_ENV_REQUIRED';
export const HEALTH_CHECK_TOKEN_REQUIRED = 'HEALTH_CHECK_TOKEN_REQUIRED';
export const GRAPHQL_PLAYGROUND_FORBIDDEN = 'GRAPHQL_PLAYGROUND_FORBIDDEN_IN_PRODUCTION';

/**
 * Fail-fast env checks (INF / Audit 2 production gates).
 * Safe to call from config factories.
 *
 * - Unset NODE_ENV is rejected unless ALLOW_UNSET_NODE_ENV=true (local tooling only).
 * - Production secrets and unsafe flags are enforced when NODE_ENV=production.
 * - Redis is optional: omit REDIS_HOST to disable cache/queues; REDIS_PASSWORD is never required.
 */
export function validateProductionSecurityEnv(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env.NODE_ENV?.trim();
  if (!nodeEnv) {
    if (env.ALLOW_UNSET_NODE_ENV === 'true') {
      return;
    }
    logger.error(NODE_ENV_REQUIRED);
    throw new Error(NODE_ENV_REQUIRED);
  }

  if (nodeEnv !== 'production') {
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

  if (!env.HEALTH_CHECK_TOKEN?.trim()) {
    logger.error(HEALTH_CHECK_TOKEN_REQUIRED);
    throw new Error(HEALTH_CHECK_TOKEN_REQUIRED);
  }

  if (env.GRAPHQL_PLAYGROUND === 'true') {
    logger.error(GRAPHQL_PLAYGROUND_FORBIDDEN);
    throw new Error(GRAPHQL_PLAYGROUND_FORBIDDEN);
  }
}
