import { registerAs } from '@nestjs/config';

const WEAK_JWT_SECRET_PATTERNS = [
  /^change-me/i,
  /^secret$/i,
  /^jwt[_-]?secret$/i,
  /^your[_-]?secret/i,
  /^test$/i,
  /^dev$/i,
  /^password$/i,
];

const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

export function assertJwtSecretStrength(
  secret: string | undefined,
  nodeEnv: string | undefined,
): void {
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }

  if (nodeEnv !== 'production') {
    return;
  }

  if (secret.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production`,
    );
  }

  if (WEAK_JWT_SECRET_PATTERNS.some((pattern) => pattern.test(secret.trim()))) {
    throw new Error(
      'JWT_SECRET appears to be a placeholder; set a strong random secret in production',
    );
  }
}

export default registerAs('jwt', () => {
  const secret = process.env.JWT_SECRET;
  assertJwtSecretStrength(secret, process.env.NODE_ENV);

  return {
    secret: secret!,
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: process.env.JWT_ISSUER || 'sopet-api',
    audience: process.env.JWT_AUDIENCE || 'sopet',
  };
});
