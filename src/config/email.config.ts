import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  templateCacheTtlMs: parseInt(process.env.EMAIL_TEMPLATE_CACHE_TTL_MS || '60000', 10),
  /** Absolute logo URL for transactional emails. When unset, derived from `API_URL` (see `resolveEmailLogoUrl`). */
  logoUrl: process.env.EMAIL_LOGO_URL?.trim() || undefined,
}));
