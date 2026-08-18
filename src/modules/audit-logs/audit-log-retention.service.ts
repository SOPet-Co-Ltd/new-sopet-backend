import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  AUDIT_LOG_RETENTION_DEFAULT_CRON,
  AUDIT_LOG_RETENTION_DEFAULT_DAYS,
  AUDIT_LOG_RETENTION_DEFAULT_TIMEZONE,
  AUDIT_LOG_RETENTION_JOB,
  AUDIT_LOG_RETENTION_QUEUE,
} from './audit-log-retention.constants';

@Injectable()
export class AuditLogRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditLogRetentionService.name);

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectQueue(AUDIT_LOG_RETENTION_QUEUE)
    private readonly retentionQueue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.retentionQueue) {
      this.logger.warn('Redis not configured — audit log retention disabled');
      return;
    }

    // Resolve once at boot so invalid env is observable (warn) even before first job.
    this.resolveRetentionDays();

    const cronSchedule =
      this.configService.get<string>('auditLog.cronSchedule') ?? AUDIT_LOG_RETENTION_DEFAULT_CRON;
    const timezone =
      this.configService.get<string>('auditLog.cronTimezone') ??
      AUDIT_LOG_RETENTION_DEFAULT_TIMEZONE;

    const existing = await this.retentionQueue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === AUDIT_LOG_RETENTION_JOB) {
        await this.retentionQueue.removeRepeatableByKey(job.key);
      }
    }

    await this.retentionQueue.add(
      AUDIT_LOG_RETENTION_JOB,
      {},
      {
        repeat: {
          pattern: cronSchedule,
          tz: timezone,
        },
        jobId: AUDIT_LOG_RETENTION_JOB,
      },
    );

    this.logger.log(`Audit log retention scheduler registered (${cronSchedule}, ${timezone})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.retentionQueue?.close();
  }

  /**
   * Effective retention window in days. Invalid/non-positive config falls back to 60.
   * Matches `Number(env) || 60` with an explicit warn for ops visibility.
   */
  resolveRetentionDays(): number {
    const configured = this.configService.get<number>('auditLog.retentionDays');
    if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
      return configured;
    }

    this.logger.warn(
      `Invalid auditLog.retentionDays (${String(configured)}); falling back to ${AUDIT_LOG_RETENTION_DEFAULT_DAYS}`,
    );
    return AUDIT_LOG_RETENTION_DEFAULT_DAYS;
  }
}
