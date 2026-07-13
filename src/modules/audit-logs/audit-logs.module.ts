import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AuditLogsService } from './audit-logs.service';
import { AuditLogsResolver } from './audit-logs.resolver';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditLogsService, AuditLogsResolver],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
