import { registerAs } from '@nestjs/config';
import { validateProductionSecurityEnv } from './production-security.env';

export default registerAs('app', () => {
  validateProductionSecurityEnv();

  const port = parseInt(process.env.PORT || '3002', 10);
  // NODE_ENV is required at boot (see validateProductionSecurityEnv) unless
  // ALLOW_UNSET_NODE_ENV=true, in which case treat as development for local DX.
  const environment =
    process.env.NODE_ENV?.trim() ||
    (process.env.ALLOW_UNSET_NODE_ENV === 'true' ? 'development' : '');

  if (!environment) {
    // Should be unreachable — validateProductionSecurityEnv already threw.
    throw new Error('NODE_ENV_REQUIRED');
  }

  return {
    port,
    environment,
    apiUrl: (process.env.API_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    corsOrigins: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
      'http://localhost:3000',
      'http://localhost:3001',
    ],
    storefrontUrl: process.env.STOREFRONT_URL || 'http://localhost:3000',
    adminPanelUrl: process.env.ADMIN_PANEL_URL || 'http://localhost:3001',
    rateLimit: {
      ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10) * 1000,
      limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    },
    // Stricter limits for OTP / login / token-probe GraphQL ops (BE2-005).
    authRateLimit: {
      ttl: parseInt(process.env.AUTH_RATE_LIMIT_TTL || '60', 10) * 1000,
      limit: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
    },
    healthCheckToken: process.env.HEALTH_CHECK_TOKEN || '',
  };
});
