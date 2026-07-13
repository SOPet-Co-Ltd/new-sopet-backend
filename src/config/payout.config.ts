import { registerAs } from '@nestjs/config';

export default registerAs('payout', () => ({
  cronSchedule: process.env.PAYOUT_CRON_SCHEDULE || '0 2 * * *',
  cronTimezone: process.env.PAYOUT_CRON_TIMEZONE || 'Asia/Bangkok',
  minPayoutAmount: Number(process.env.PAYOUT_MIN_AMOUNT || 500),
}));
