/**
 * Production boot-time security checks (SOPET-M-02, M-03, M-07, M-08).
 * Call once during Nest bootstrap after ConfigModule loads env.
 */

import { assertJwtSecretStrength } from './jwt.config';
import { assertOtpHmacSecret } from './otp.config';
import { assertPostgresSslBootConfig } from '../database/postgres-ssl.util';

export function assertProductionSecurityConfig(): void {
  const nodeEnv = process.env.NODE_ENV;

  assertJwtSecretStrength(process.env.JWT_SECRET, nodeEnv);
  assertOtpHmacSecret(process.env.OTP_HMAC_SECRET, nodeEnv, process.env.JWT_SECRET);

  if (nodeEnv === 'production') {
    if (!process.env.BANK_DATA_ENCRYPTION_KEY?.trim()) {
      throw new Error('BANK_DATA_ENCRYPTION_KEY is required in production');
    }
  }

  assertPostgresSslBootConfig();
}
