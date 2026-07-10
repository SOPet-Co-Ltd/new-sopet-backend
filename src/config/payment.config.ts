import { registerAs } from '@nestjs/config';

export default registerAs('payment', () => ({
  qrExpiryMinutes: Number(process.env.PAYMENT_QR_EXPIRY_MINUTES || 15),
  expiryCheckIntervalMs: Number(process.env.PAYMENT_EXPIRY_CHECK_INTERVAL_MS || 30_000),
}));
