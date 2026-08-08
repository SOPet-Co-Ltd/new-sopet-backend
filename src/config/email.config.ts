import { registerAs } from '@nestjs/config';

export default registerAs('email', () => ({
  templateCacheTtlMs: parseInt(process.env.EMAIL_TEMPLATE_CACHE_TTL_MS || '60000', 10),
}));
