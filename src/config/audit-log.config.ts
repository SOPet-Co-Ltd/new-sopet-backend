import { registerAs } from '@nestjs/config';

function parseRetentionDays(raw: string | undefined): number {
  const parsed = Number(raw);
  // Number(env) || 60 — non-positive / NaN fall back to 60
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

export default registerAs('auditLog', () => ({
  retentionDays: parseRetentionDays(process.env.AUDIT_LOG_RETENTION_DAYS),
  cronSchedule: process.env.AUDIT_LOG_CRON_SCHEDULE || '0 3 * * *',
  cronTimezone: process.env.AUDIT_LOG_CRON_TIMEZONE || 'Asia/Bangkok',
}));
