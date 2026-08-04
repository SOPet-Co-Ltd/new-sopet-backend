import { registerAs } from '@nestjs/config';

export default registerAs('payment', () => ({
  qrExpiryMinutes: Number(process.env.PAYMENT_QR_EXPIRY_MINUTES || 15),
  expiryCheckIntervalMs: Number(process.env.PAYMENT_EXPIRY_CHECK_INTERVAL_MS || 30_000),
  omiseCancelTimeoutMs: Number(process.env.PAYMENT_OMISE_CANCEL_TIMEOUT_MS || 4000),
  unpaidOrderCancelAfterMs: Number(process.env.PAYMENT_UNPAID_ORDER_CANCEL_AFTER_MS || 86_400_000),
}));
