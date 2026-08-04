import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsResolver } from './audit-logs.resolver';
import { AuditLogsService } from './audit-logs.service';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { AuditAction, AuditResourceType } from './audit-log.constants';

describe('AuditLogsResolver', () => {
  let resolver: AuditLogsResolver;

  const auditLogsService = {
    findAllForAdmin: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditLogsResolver, { provide: AuditLogsService, useValue: auditLogsService }],
    }).compile();

    resolver = module.get(AuditLogsResolver);
  });

  it('returns paginated admin audit logs', async () => {
    auditLogsService.findAllForAdmin.mockResolvedValue({
      items: [
        {
          id: 'log-1',
          actorType: AuditActorType.ADMIN,
          actorId: 'admin-1',
          actorLabel: 'admin@sopet.org',
          action: AuditAction.LOGIN,
          resourceType: AuditResourceType.USER,
          resourceId: 'admin-1',
          metadata: { role: 'admin' },
          ipAddress: null,
          createdAt: new Date('2026-07-14T00:00:00Z'),
        },
      ],
      total: 1,
    });

    const result = await resolver.adminAuditLogs(1, 20, {
      action: AuditAction.LOGIN,
    });

    expect(auditLogsService.findAllForAdmin).toHaveBeenCalledWith(1, 20, {
      action: AuditAction.LOGIN,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].metadata).toBe(JSON.stringify({ role: 'admin' }));
    expect(result.pagination.total).toBe(1);
  });
});
