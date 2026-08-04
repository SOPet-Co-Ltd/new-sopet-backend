import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog, AuditActorType } from '../../database/entities/audit-log.entity';
import { AuditAction, AuditResourceType } from './audit-log.constants';

describe('AuditLogsService', () => {
  let service: AuditLogsService;

  const auditLogRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'log-1' })),
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
});
