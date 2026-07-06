import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3002', 10),
  environment: process.env.NODE_ENV || 'development',
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
}));
