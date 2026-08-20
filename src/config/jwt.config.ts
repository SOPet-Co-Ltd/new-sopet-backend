import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return {
    secret,
    accessTokenExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    /** BE2-012 — pin issuer/audience; keep defaults stable across API + BFF verify. */
    issuer: process.env.JWT_ISSUER || 'sopet',
    audience: process.env.JWT_AUDIENCE || 'sopet-api',
  };
});
