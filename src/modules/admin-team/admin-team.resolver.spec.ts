import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import { AcceptAdminInvitationInput, AdminTeamResolver } from './admin-team.resolver';
import { AdminTeamService } from './admin-team.service';
import { AuthService } from '../auth/auth.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { UserRole } from '../../database/entities/user.entity';

describe('AcceptAdminInvitationInput fullName validation', () => {
  const validationPipe = new ValidationPipe();

  const validate = (value: unknown) =>
    validationPipe.transform(value, {
      metatype: AcceptAdminInvitationInput,
      type: 'body',
    } as never);

  it('rejects a whitespace-only fullName', async () => {
    await expect(
      validate({
        token: 'tok-1',
        password: 'password123',
        fullName: '   ',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a fullName with real content', async () => {
    const result = await validate({
      token: 'tok-1',
      password: 'password123',
      fullName: 'New Admin',
    });
    expect(result).toBeDefined();
  });
});

describe('AdminTeamResolver audit logging (QA-hunt regression: privilege actions were never recorded)', () => {
  let resolver: AdminTeamResolver;
  let adminTeamService: {
    invite: jest.Mock;
    revokeInvitation: jest.Mock;
    setAdminActive: jest.Mock;
    acceptInvitation: jest.Mock;
  };
  let authService: { login: jest.Mock };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    adminTeamService = {
      invite: jest.fn(),
      revokeInvitation: jest.fn(),
      setAdminActive: jest.fn(),
      acceptInvitation: jest.fn(),
    };

    authService = {
      login: jest.fn(),
    };

    auditLogsService = {
      log: jest.fn(),
    };

    resolver = new AdminTeamResolver(
      adminTeamService as unknown as AdminTeamService,
      authService as unknown as AuthService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('records an audit log when an admin invites a new admin', async () => {
    adminTeamService.invite.mockResolvedValue({
      id: 'inv-1',
      email: 'new-admin@sopet.org',
      status: 'PENDING',
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    });

    await resolver.inviteAdmin('admin-1', 'admin1@sopet.org', { email: 'new-admin@sopet.org' });

    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: 'admin-1',
        actorLabel: 'admin1@sopet.org',
        action: AuditAction.ADMIN_INVITED,
        resourceType: AuditResourceType.ADMIN_INVITATION,
        resourceId: 'inv-1',
      }),
    );
  });

  it('records an audit log when an admin revokes a pending invitation', async () => {
    adminTeamService.revokeInvitation.mockResolvedValue({
      id: 'inv-2',
      email: 'revoked@sopet.org',
      status: 'REVOKED',
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    });

    await resolver.revokeAdminInvitation('admin-1', 'admin1@sopet.org', 'inv-2');

    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: 'admin-1',
        action: AuditAction.ADMIN_INVITATION_REVOKED,
        resourceType: AuditResourceType.ADMIN_INVITATION,
        resourceId: 'inv-2',
      }),
    );
  });

  it('records an audit log when an admin activates/deactivates another admin', async () => {
    adminTeamService.setAdminActive.mockResolvedValue({
      id: 'user-2',
      email: 'other-admin@sopet.org',
      fullName: 'Other Admin',
      isActive: false,
      role: UserRole.ADMIN,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    await resolver.setAdminActive('admin-1', 'admin1@sopet.org', 'user-2', false);

    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: 'admin-1',
        action: AuditAction.ADMIN_STATUS_CHANGED,
        resourceType: AuditResourceType.USER,
        resourceId: 'user-2',
        metadata: { email: 'other-admin@sopet.org', isActive: false },
      }),
    );
  });

  it('records a system-actor audit log when a new admin accepts their invitation', async () => {
    adminTeamService.acceptInvitation.mockResolvedValue({
      id: 'user-3',
      email: 'invitee@sopet.org',
      fullName: 'New Admin',
      role: UserRole.ADMIN,
      profilePhotoUrl: null,
      emailVerified: true,
    });
    authService.login.mockResolvedValue({
      accessToken: 'access-tok',
      refreshToken: 'refresh-tok',
      user: {
        id: 'user-3',
        email: 'invitee@sopet.org',
        fullName: 'New Admin',
        role: UserRole.ADMIN,
        profilePhotoUrl: null,
        emailVerified: true,
      },
    });

    await resolver.acceptAdminInvitation({
      token: 'tok-1',
      password: 'password123',
      fullName: 'New Admin',
    });

    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.SYSTEM,
        actorId: null,
        action: AuditAction.ADMIN_INVITATION_ACCEPTED,
        resourceType: AuditResourceType.USER,
        resourceId: 'user-3',
      }),
    );
  });
});
