import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

type CommissionConfigModule = {
  resolveCommissionConfig: (env?: NodeJS.ProcessEnv) => {
    goLiveAt: Date | undefined;
    defaultRatePercent: number;
  };
};

function loadCommissionConfig(): CommissionConfigModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./commission.config') as CommissionConfigModule;
}

describe('commission.config', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should throw COMMISSION_GO_LIVE_UNCONFIGURED when production goLiveAt is missing', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { resolveCommissionConfig } = loadCommissionConfig();

    expect(() => resolveCommissionConfig({ NODE_ENV: 'production' })).toThrow(
      'COMMISSION_GO_LIVE_UNCONFIGURED',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('COMMISSION_GO_LIVE_UNCONFIGURED'),
    );
  });

  it('should throw COMMISSION_GO_LIVE_UNCONFIGURED when production goLiveAt is unparsable', () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { resolveCommissionConfig } = loadCommissionConfig();

    expect(() =>
      resolveCommissionConfig({
        NODE_ENV: 'production',
        COMMISSION_GO_LIVE_AT: 'not-a-date',
      }),
    ).toThrow('COMMISSION_GO_LIVE_UNCONFIGURED');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('COMMISSION_GO_LIVE_UNCONFIGURED'),
    );
  });

  it('should return parsed goLiveAt and constant defaultRatePercent 7 when configured', () => {
    const { resolveCommissionConfig } = loadCommissionConfig();

    const config = resolveCommissionConfig({
      NODE_ENV: 'production',
      COMMISSION_GO_LIVE_AT: '2026-01-01T00:00:00.000Z',
    });

    expect(config.goLiveAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(config.defaultRatePercent).toBe(7);
  });

  it('should not default goLiveAt to now when missing outside production', () => {
    const { resolveCommissionConfig } = loadCommissionConfig();

    const config = resolveCommissionConfig({ NODE_ENV: 'test' });

    expect(config.goLiveAt).toBeUndefined();
    expect(config.defaultRatePercent).toBe(7);
  });
});

describe('StoreCommission migration', () => {
  const migrationsDir = path.join(__dirname, '../database/migrations');

  it('should add nullable columns without backfill or a default of 7', () => {
    const files = fs.readdirSync(migrationsDir).filter((name) => name.includes('StoreCommission'));
    expect(files).toHaveLength(1);
    const sql = fs.readFileSync(path.join(migrationsDir, files[0]), 'utf8');

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "commission_rate" integer/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "product_sold" numeric\(10,2\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "shipping_fees" numeric\(10,2\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "commission_amount" numeric\(10,2\)/);
    expect(sql).not.toMatch(/UPDATE\s+"?(payouts|stores)"?/i);
    expect(sql).not.toMatch(/SET DEFAULT 7/i);
    expect(sql).not.toMatch(/DEFAULT 7/);
    expect(sql).not.toMatch(/jsonb|json/i);
    expect(sql).not.toMatch(/INSERT INTO "payout_items"/i);
  });
});
