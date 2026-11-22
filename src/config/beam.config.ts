import { registerAs } from '@nestjs/config';

export default registerAs('beam', () => ({
  apiBaseUrl: (process.env.BEAM_API_BASE_URL || 'https://api.beamcheckout.com').replace(/\/$/, ''),
  merchantId: process.env.BEAM_MERCHANT_ID || '',
  apiKey: process.env.BEAM_API_KEY || '',
  publishableKey: process.env.BEAM_PUBLISHABLE_KEY || '',
  webhookSecret: process.env.BEAM_WEBHOOK_SECRET || '',
}));
