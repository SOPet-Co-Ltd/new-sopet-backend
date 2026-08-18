import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { validate } from 'class-validator';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog, AuditActorType } from '../../database/entities/audit-log.entity';
import { AuditAction, AuditResourceType } from './audit-log.constants';
import { AdminAuditLogFilterInput } from './audit-logs.inputs';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  const auditLogRepo = {
    create: jest.fn((x: Record<string, unknown>) => x),
    save: jest.fn((x: Record<string, unknown>) => Promise.resolve({ ...x, id: 'log-1' })),
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        { provide: getRepositoryToken(AuditLog), useValue: auditLogRepo },
      ],
    }).compile();

    service = module.get(AuditLogsService);
  });

  it('persists audit log entries without throwing', async () => {
    await service.log({
      actorType: AuditActorType.ADMIN,
      actorId: 'admin-1',
      actorLabel: 'admin@sopet.org',
      action: AuditAction.STORE_UPDATED,
      resourceType: AuditResourceType.STORE,
      resourceId: 'store-1',
      metadata: { storeName: 'Test Store' },
    });

    expect(auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.STORE_UPDATED,
        resourceType: AuditResourceType.STORE,
      }),
    );
    expect(auditLogRepo.save).toHaveBeenCalled();
  });

  it('swallows persistence errors', async () => {
    auditLogRepo.save.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.log({
        actorType: AuditActorType.SYSTEM,
        action: AuditAction.LOGIN,
        resourceType: AuditResourceType.USER,
      }),
    ).resolves.toBeUndefined();
  });

  it('dual-writes requestId to column and metadata.requestId while keeping other metadata keys', async () => {
    await service.log({
      actorType: AuditActorType.ADMIN,
      actorId: 'admin-1',
      action: AuditAction.STORE_UPDATED,
      resourceType: AuditResourceType.STORE,
      resourceId: 'store-1',
      requestId: 'req-abc-123',
      metadata: { storeName: 'Test Store', before: { status: 'active' } },
      ipAddress: '1.2.3.4',
    });

    expect(auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-abc-123',
        metadata: {
          storeName: 'Test Store',
          before: { status: 'active' },
          requestId: 'req-abc-123',
        },
        ipAddress: '1.2.3.4',
      }),
    );
    const created = auditLogRepo.create.mock.calls[0][0] as {
      requestId: string;
      metadata: { requestId: string };
    };
    expect(created.requestId).toBe(created.metadata.requestId);
  });

  it('does not inject metadata.requestId when requestId is omitted', async () => {
    await service.log({
      actorType: AuditActorType.ADMIN,
      action: AuditAction.LOGIN,
      resourceType: AuditResourceType.USER,
      metadata: { role: 'admin' },
    });

    expect(auditLogRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: null,
        metadata: { role: 'admin' },
      }),
    );
  });

  it('applies filters when listing logs for admin', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'log-1' }], 1]),
    };
    auditLogRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.findAllForAdmin(1, 20, {
      action: AuditAction.LOGIN,
      resourceType: AuditResourceType.USER,
      actorType: AuditActorType.ADMIN,
      search: 'admin',
    });

    expect(qb.andWhere).toHaveBeenCalled();
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('applies equality filter on log.requestId when filter.requestId is set', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    auditLogRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findAllForAdmin(1, 20, { requestId: 'req-xyz' });

    expect(qb.andWhere).toHaveBeenCalledWith('log.requestId = :requestId', {
      requestId: 'req-xyz',
    });
    const clauses = qb.andWhere.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(clauses.some((c: string) => /ILIKE/i.test(c) && /requestId/i.test(c))).toBe(false);
    expect(
      clauses.some((c: string) => /CAST\(log\.metadata/i.test(c) && /requestId/i.test(c)),
    ).toBe(false);
    expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
  });

  it('omits requestId clause when filter.requestId is unset', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    auditLogRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findAllForAdmin(1, 20, { action: AuditAction.LOGIN });

    const clauses = qb.andWhere.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(clauses.some((c: string) => c.includes('log.requestId'))).toBe(false);
  });

  it('caps take at 100 and keeps createdAt DESC when limit exceeds cap', async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    auditLogRepo.createQueryBuilder.mockReturnValue(qb);

    await service.findAllForAdmin(1, 500, { requestId: 'req-cap' });

    expect(qb.take).toHaveBeenCalledWith(100);
    expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    expect(qb.andWhere).toHaveBeenCalledWith('log.requestId = :requestId', {
      requestId: 'req-cap',
    });
  });

  describe('purgeExpired', () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    it('deletes only rows with created_at < cutoff (61d eligible, 1d intact)', async () => {
      const frozenNow = new Date('2026-08-19T10:00:00.000Z');
      jest.useFakeTimers({ now: frozenNow });

      let capturedCutoff: Date | undefined;
      const deleteQb = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockImplementation((_sql: string, params: { cutoff: Date }) => {
          capturedCutoff = params.cutoff;
          return deleteQb;
        }),
        setParameters: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 2 }),
      };
      auditLogRepo.createQueryBuilder.mockReturnValue(deleteQb);

      const cutoff = new Date(frozenNow.getTime() - 60 * MS_PER_DAY);
      const deleted = await service.purgeExpired(cutoff, 1000);

      expect(deleted).toBe(2);
      expect(capturedCutoff).toEqual(cutoff);

      const eligible61d = new Date(frozenNow.getTime() - 61 * MS_PER_DAY);
      const intact1d = new Date(frozenNow.getTime() - 1 * MS_PER_DAY);
      expect(eligible61d.getTime()).toBeLessThan(cutoff.getTime());
      expect(intact1d.getTime()).toBeGreaterThanOrEqual(cutoff.getTime());

      const whereCall = deleteQb.where.mock.calls[0] as [string, { cutoff: Date; limit: number }];
      const whereSql = String(whereCall[0]);
      expect(whereSql).toMatch(/created_at\s*<\s*:cutoff/i);
      expect(whereSql).not.toMatch(/created_at\s*<=\s*:cutoff/i);

      jest.useRealTimers();
    });

    it('uses cutoff ≈ now−60d when retentionDays is 60', async () => {
      const frozenNow = new Date('2026-08-19T10:00:00.000Z');
      jest.useFakeTimers({ now: frozenNow });

      const deleteQb = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      auditLogRepo.createQueryBuilder.mockReturnValue(deleteQb);

      const cutoff = new Date(frozenNow.getTime() - 60 * MS_PER_DAY);
      await service.purgeExpired(cutoff, 1000);

      const whereCall = deleteQb.where.mock.calls[0] as [string, { cutoff: Date; limit: number }];
      const passed = whereCall[1];
      expect(passed.cutoff.getTime()).toBe(cutoff.getTime());
      expect(Math.abs(frozenNow.getTime() - passed.cutoff.getTime() - 60 * MS_PER_DAY)).toBe(0);
      expect(passed.limit).toBe(1000);

      jest.useRealTimers();
    });
  });
});

describe('AdminAuditLogFilterInput requestId validation', () => {
  it('rejects requestId longer than 64 characters', async () => {
    const input = new AdminAuditLogFilterInput();
    input.requestId = 'x'.repeat(65);
    const errors = await validate(input);
    expect(errors.some((e) => e.property === 'requestId')).toBe(true);
  });

  it('accepts requestId of length 64', async () => {
    const input = new AdminAuditLogFilterInput();
    input.requestId = 'y'.repeat(64);
    const errors = await validate(input);
    expect(errors.filter((e) => e.property === 'requestId')).toHaveLength(0);
  });
});
