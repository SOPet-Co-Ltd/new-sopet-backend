import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AuditLogRetentionProcessor } from './audit-log-retention.processor';
import {
  AUDIT_LOG_RETENTION_BATCH_SIZE,
  AUDIT_LOG_RETENTION_CONCURRENCY,
  AUDIT_LOG_RETENTION_DEFAULT_CRON,
  AUDIT_LOG_RETENTION_DEFAULT_TIMEZONE,
  AUDIT_LOG_RETENTION_JOB,
  AUDIT_LOG_RETENTION_QUEUE,
} from './audit-log-retention.constants';

describe('AuditLogRetentionProcessor', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const auditLogsService = {
    purgeExpired: jest.fn(),
  };

  const retentionService = {
    resolveRetentionDays: jest.fn().mockReturnValue(60),
  };

  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    retentionService.resolveRetentionDays.mockReturnValue(60);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('matches AC-B-018 queue, job, batch, cron, timezone, and concurrency constants', () => {
    expect(AUDIT_LOG_RETENTION_QUEUE).toBe('audit-log-retention');
    expect(AUDIT_LOG_RETENTION_JOB).toBe('purge-expired-audit-logs');
    expect(AUDIT_LOG_RETENTION_BATCH_SIZE).toBe(1000);
    expect(AUDIT_LOG_RETENTION_CONCURRENCY).toBe(1);
    expect(AUDIT_LOG_RETENTION_DEFAULT_CRON).toBe('0 3 * * *');
    expect(AUDIT_LOG_RETENTION_DEFAULT_TIMEZONE).toBe('Asia/Bangkok');
  });

  it('loops purgeExpired in batches of 1000 until a batch deletes 0 rows', async () => {
    const frozenNow = new Date('2026-08-19T10:00:00.000Z');
    jest.useFakeTimers({ now: frozenNow });

    auditLogsService.purgeExpired
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(1000)
      .mockResolvedValueOnce(0);

    const processor = new AuditLogRetentionProcessor(
      auditLogsService as never,
      retentionService as never,
    );

    await processor.process({ name: AUDIT_LOG_RETENTION_JOB } as Job);

    expect(auditLogsService.purgeExpired).toHaveBeenCalledTimes(3);
    const expectedCutoff = new Date(frozenNow.getTime() - 60 * MS_PER_DAY);
    expect(auditLogsService.purgeExpired).toHaveBeenNthCalledWith(
      1,
      expectedCutoff,
      AUDIT_LOG_RETENTION_BATCH_SIZE,
    );

    jest.useRealTimers();
  });

  it('ignores jobs that are not purge-expired-audit-logs', async () => {
    const processor = new AuditLogRetentionProcessor(
      auditLogsService as never,
      retentionService as never,
    );

    await processor.process({ name: 'other-job' } as Job);

    expect(auditLogsService.purgeExpired).not.toHaveBeenCalled();
  });

  it('logs error and rethrows when purgeExpired fails (no silent fail-open)', async () => {
    const boom = new Error('db delete failed');
    auditLogsService.purgeExpired.mockRejectedValueOnce(boom);

    const processor = new AuditLogRetentionProcessor(
      auditLogsService as never,
      retentionService as never,
    );

    await expect(processor.process({ name: AUDIT_LOG_RETENTION_JOB } as Job)).rejects.toThrow(
      'db delete failed',
    );

    expect(errorSpy).toHaveBeenCalled();
  });
});
