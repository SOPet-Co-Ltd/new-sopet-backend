import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuditLogsService } from './audit-logs.service';
import { AdminAuditLogConnection, AdminAuditLogType } from '../../graphql/models/types';
import { AdminAuditLogFilterInput } from './audit-logs.inputs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators';
import { AuditLog } from '../../database/entities/audit-log.entity';

function mapAuditLog(log: AuditLog): AdminAuditLogType {
  return {
    id: log.id,
    actorType: log.actorType,
    actorId: log.actorId,
    actorLabel: log.actorLabel,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    metadata: log.metadata ? JSON.stringify(log.metadata) : null,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt,
  };
}

@Resolver()
export class AuditLogsResolver {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Query(() => AdminAuditLogConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminAuditLogs(
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('limit', { type: () => Int, defaultValue: 20 }) limit: number,
    @Args('filter', { nullable: true }) filter?: AdminAuditLogFilterInput,
  ): Promise<AdminAuditLogConnection> {
    const result = await this.auditLogsService.findAllForAdmin(page, limit, filter ?? {});
    const totalPages = Math.max(1, Math.ceil(result.total / Math.min(Math.max(limit, 1), 100)));

    return {
      items: result.items.map(mapAuditLog),
      pagination: {
        page: Math.max(1, page),
        limit: Math.min(Math.max(limit, 1), 100),
        total: result.total,
        totalPages,
      },
    };
  }
}
