import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';
import { AdminAuditLogFilter, AuditLogInput } from './audit-logs.types';

@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      const requestId = input.requestId ?? null;
      const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
      if (requestId != null) {
        metadata.requestId = requestId;
      }

      const entry = this.auditLogRepository.create({
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata,
        ipAddress: input.ipAddress ?? null,
        requestId,
      });
      await this.auditLogRepository.save(entry);
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action=${input.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAllForAdmin(
    page: number,
    limit: number,
    filter: AdminAuditLogFilter = {},
  ): Promise<{ items: AuditLog[]; total: number }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const offset = (safePage - 1) * safeLimit;

    const qb = this.auditLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip(offset)
      .take(safeLimit);

    if (filter.action) {
      qb.andWhere('log.action = :action', { action: filter.action });
    }
    if (filter.resourceType) {
      qb.andWhere('log.resourceType = :resourceType', { resourceType: filter.resourceType });
    }
    if (filter.actorType) {
      qb.andWhere('log.actorType = :actorType', { actorType: filter.actorType });
    }
    if (filter.actorId) {
      qb.andWhere('log.actorId = :actorId', { actorId: filter.actorId });
    }
    if (filter.fromDate) {
      qb.andWhere('log.createdAt >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('log.createdAt <= :toDate', { toDate: filter.toDate });
    }
    if (filter.requestId) {
      qb.andWhere('log.requestId = :requestId', { requestId: filter.requestId });
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim()}%`;
      qb.andWhere(
        `(log.actorLabel ILIKE :term OR log.action ILIKE :term OR log.resourceType ILIKE :term OR CAST(log.metadata AS TEXT) ILIKE :term)`,
        { term },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Hard-delete one batch of audit_logs older than cutoff.
   * Returns rows deleted (0 when none remain). Caller loops until 0.
   * Only deletes where created_at < cutoff — never created_at >= cutoff.
   */
  async purgeExpired(cutoff: Date, limit: number): Promise<number> {
    const result = await this.auditLogRepository
      .createQueryBuilder()
      .delete()
      .from(AuditLog)
      .where(
        `id IN (
          SELECT id FROM (
            SELECT id FROM audit_logs
            WHERE created_at < :cutoff
            ORDER BY created_at ASC
            LIMIT :limit
          ) AS expired_audit_logs
        )`,
        { cutoff, limit },
      )
      .execute();

    return result.affected ?? 0;
  }
}
