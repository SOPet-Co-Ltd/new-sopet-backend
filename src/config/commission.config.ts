import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

const logger = new Logger('CommissionConfig');

/** Effective rate when `stores.commission_rate` is NULL. Not env-overridable. */
export const DEFAULT_COMMISSION_RATE_PERCENT = 7;

export const COMMISSION_GO_LIVE_UNCONFIGURED = 'COMMISSION_GO_LIVE_UNCONFIGURED';

function parseGoLiveAt(raw: string | undefined): Date | undefined {
  if (raw == null || raw.trim() === '') {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

export function resolveCommissionConfig(env: NodeJS.ProcessEnv = process.env): {
  goLiveAt: Date | undefined;
  defaultRatePercent: typeof DEFAULT_COMMISSION_RATE_PERCENT;
} {
  const goLiveAt = parseGoLiveAt(env.COMMISSION_GO_LIVE_AT);

  if (env.NODE_ENV === 'production' && goLiveAt === undefined) {
    logger.error(COMMISSION_GO_LIVE_UNCONFIGURED);
    throw new Error(COMMISSION_GO_LIVE_UNCONFIGURED);
  }

  return {
    goLiveAt,
    defaultRatePercent: DEFAULT_COMMISSION_RATE_PERCENT,
  };
}

export default registerAs('commission', () => resolveCommissionConfig());
