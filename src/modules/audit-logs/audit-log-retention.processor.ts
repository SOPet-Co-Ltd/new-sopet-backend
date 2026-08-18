import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogRetentionService } from './audit-log-retention.service';
import {
  AUDIT_LOG_RETENTION_BATCH_SIZE,
  AUDIT_LOG_RETENTION_CONCURRENCY,
  AUDIT_LOG_RETENTION_JOB,
  AUDIT_LOG_RETENTION_QUEUE,
} from './audit-log-retention.constants';

@Processor(AUDIT_LOG_RETENTION_QUEUE, { concurrency: AUDIT_LOG_RETENTION_CONCURRENCY })
export class AuditLogRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditLogRetentionProcessor.name);

  constructor(
    private readonly auditLogsService: AuditLogsService,
    private readonly retentionService: AuditLogRetentionService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== AUDIT_LOG_RETENTION_JOB) {
      return;
    }

    const retentionDays = this.retentionService.resolveRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      let deleted: number;
      do {
        deleted = await this.auditLogsService.purgeExpired(cutoff, AUDIT_LOG_RETENTION_BATCH_SIZE);
      } while (deleted > 0);
    } catch (error) {
      this.logger.error(
        'Audit log retention purge failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}
