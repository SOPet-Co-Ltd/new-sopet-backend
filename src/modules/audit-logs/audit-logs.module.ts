import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';
import auditLogConfig from '../../config/audit-log.config';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsResolver } from './audit-logs.resolver';
import { AuditLogRetentionService } from './audit-log-retention.service';
import { AuditLogRetentionProcessor } from './audit-log-retention.processor';
import { AUDIT_LOG_RETENTION_QUEUE } from './audit-log-retention.constants';

const retentionQueueImports = isRedisConfigured()
  ? [
      BullModule.registerQueue({
        name: AUDIT_LOG_RETENTION_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
        },
      }),
    ]
  : [];

const retentionQueueProviders = isRedisConfigured() ? [AuditLogRetentionProcessor] : [];

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(auditLogConfig),
    ...retentionQueueImports,
    TypeOrmModule.forFeature([AuditLog]),
  ],
  providers: [
    AuditLogsService,
    AuditLogsResolver,
    AuditLogRetentionService,
    ...retentionQueueProviders,
  ],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
