import { registerAs } from '@nestjs/config';
import { resolveBeamLighthouseBaseUrl } from '../modules/beam/beam-lighthouse.util';

export default registerAs('beam', () => {
  const apiBaseUrl = (process.env.BEAM_API_BASE_URL || 'https://api.beamcheckout.com').replace(
    /\/$/,
    '',
  );

  return {
    apiBaseUrl,
    lighthouseBaseUrl: resolveBeamLighthouseBaseUrl(
      apiBaseUrl,
      process.env.BEAM_LIGHTHOUSE_BASE_URL,
    ),
    merchantId: (process.env.BEAM_MERCHANT_ID || '').trim(),
    apiKey: process.env.BEAM_API_KEY || '',
    publishableKey: process.env.BEAM_PUBLISHABLE_KEY || '',
    webhookSecret: process.env.BEAM_WEBHOOK_SECRET || '',
  };
});
