import { Logger } from '@nestjs/common';
import { AuditLogRetentionService } from './audit-log-retention.service';
import { AUDIT_LOG_RETENTION_JOB } from './audit-log-retention.constants';

describe('AuditLogRetentionService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'auditLog.cronSchedule') return '0 3 * * *';
      if (key === 'auditLog.cronTimezone') return 'Asia/Bangkok';
      if (key === 'auditLog.retentionDays') return 60;
      return undefined;
    }),
  };

  const retentionQueue = {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn(),
    add: jest.fn(),
    close: jest.fn(),
  };

  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('warns and returns when Redis/queue is unavailable (no-op boot)', async () => {
    const service = new AuditLogRetentionService(configService as never);

    await service.onModuleInit();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Redis not configured.*audit.?log.?retention/i),
    );
    expect(retentionQueue.add).not.toHaveBeenCalled();
  });

  it('registers purge-expired-audit-logs repeatable job when queue is present', async () => {
    const service = new AuditLogRetentionService(configService as never, retentionQueue as never);

    await service.onModuleInit();

    expect(retentionQueue.add).toHaveBeenCalledWith(
      AUDIT_LOG_RETENTION_JOB,
      {},
      expect.objectContaining({
        repeat: {
          pattern: '0 3 * * *',
          tz: 'Asia/Bangkok',
        },
        jobId: AUDIT_LOG_RETENTION_JOB,
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/registered/i));
  });

  it('falls back to 60 retentionDays and warns when configured value is invalid', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'auditLog.cronSchedule') return '0 3 * * *';
      if (key === 'auditLog.cronTimezone') return 'Asia/Bangkok';
      if (key === 'auditLog.retentionDays') return Number.NaN;
      return undefined;
    });

    const service = new AuditLogRetentionService(configService as never, retentionQueue as never);
    const days = service.resolveRetentionDays();

    expect(days).toBe(60);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/retentionDays|fallback|invalid/i));
  });

  it('falls back to 60 when retentionDays is non-positive', () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'auditLog.retentionDays') return 0;
      return undefined;
    });

    const service = new AuditLogRetentionService(configService as never, retentionQueue as never);
    expect(service.resolveRetentionDays()).toBe(60);
  });
});
