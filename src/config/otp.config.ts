import { registerAs } from '@nestjs/config';

/**
 * Dedicated HMAC key for OTP at-rest hashing (SOPET-M-03).
 * Must not reuse JWT_SECRET.
 */
export function assertOtpHmacSecret(
  secret: string | undefined,
  nodeEnv: string | undefined,
  jwtSecret?: string,
): string | undefined {
  if (nodeEnv === 'production') {
    if (!secret?.trim()) {
      throw new Error('OTP_HMAC_SECRET environment variable is required in production');
    }
    if (jwtSecret && secret === jwtSecret) {
      throw new Error('OTP_HMAC_SECRET must not equal JWT_SECRET');
    }
    if (secret.trim().length < 32) {
      throw new Error('OTP_HMAC_SECRET must be at least 32 characters in production');
    }
  }

  return secret?.trim() || undefined;
}

export default registerAs('otp', () => {
  const nodeEnv = process.env.NODE_ENV;
  let secret = assertOtpHmacSecret(process.env.OTP_HMAC_SECRET, nodeEnv, process.env.JWT_SECRET);

  // Local/dev convenience when OTP_HMAC_SECRET is unset — never used in production.
  if (!secret && nodeEnv !== 'production') {
    secret = 'dev-otp-hmac-secret-change-me-locally';
  }

  return {
    hmacSecret: secret,
    /** Failed verify attempts before the OTP row is locked / marked used (SOPET-M-15). */
    maxFailedAttempts: parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10) || 5,
  };
});
