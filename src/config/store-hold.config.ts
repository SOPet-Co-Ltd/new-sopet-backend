import { registerAs } from '@nestjs/config';

/** Default hold SLA: 30 days in milliseconds. */
const DEFAULT_HOLD_SLA_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Default SLA check interval: 30 seconds (aligned with payment expiry check). */
const DEFAULT_SLA_CHECK_INTERVAL_MS = 30_000;

export default registerAs('storeHold', () => ({
  holdSlaAfterMs: Number(process.env.STORE_HOLD_SLA_AFTER_MS || DEFAULT_HOLD_SLA_AFTER_MS),
  slaCheckIntervalMs: Number(
    process.env.STORE_HOLD_SLA_CHECK_INTERVAL_MS || DEFAULT_SLA_CHECK_INTERVAL_MS,
  ),
}));
