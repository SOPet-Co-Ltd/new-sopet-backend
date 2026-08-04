import { AuditActorType } from '../../database/entities/audit-log.entity';

export interface AuditLogInput {
  actorType: AuditActorType;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface AdminAuditLogFilter {
  action?: string;
  resourceType?: string;
  actorType?: AuditActorType;
  actorId?: string;
  search?: string;
  fromDate?: Date;
  toDate?: Date;
}
