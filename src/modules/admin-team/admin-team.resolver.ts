import { Args, Field, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, Length, Matches, MinLength } from 'class-validator';
import { AdminTeamService } from './admin-team.service';
import {
  AdminInvitationType,
  AdminTeamMemberType,
  VendorAuthPayload,
} from '../../graphql/models/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, Roles } from '../../common/decorators';
import { AdminInvitation } from '../../database/entities/admin-invitation.entity';
import { User } from '../../database/entities/user.entity';
import { AuthService } from '../auth/auth.service';
import { mapUserProfile } from '../../graphql/models/mappers';
import { AuthRateLimitGuard } from '../auth/guards/auth-rate-limit.guard';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';

@InputType()
export class InviteAdminInput {
  @Field()
  @IsEmail()
  email!: string;
}

@InputType()
export class AcceptAdminInvitationInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  token!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  // Length/IsNotEmpty alone let whitespace-only input (e.g. "   ") through.
  @Matches(/\S/, { message: 'fullName cannot be blank or whitespace-only' })
  fullName!: string;
}

@Resolver()
export class AdminTeamResolver {
  constructor(
    private readonly adminTeamService: AdminTeamService,
    private readonly authService: AuthService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  @Query(() => [AdminTeamMemberType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminTeamMembers(): Promise<AdminTeamMemberType[]> {
    const members = await this.adminTeamService.listMembers();
    return members.map(mapMember);
  }

  @Query(() => [AdminInvitationType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingAdminInvitations(): Promise<AdminInvitationType[]> {
    const invitations = await this.adminTeamService.findPendingInvitations();
    return invitations.map(mapInvitation);
  }

  @Mutation(() => AdminInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async inviteAdmin(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('input') input: InviteAdminInput,
  ): Promise<AdminInvitationType> {
    const invitation = await this.adminTeamService.invite(input.email, adminId);

    // Granting admin-team access is a privilege-escalation action - it must be traceable
    // the same way store/customer/payout privilege changes already are.
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.ADMIN_INVITED,
      resourceType: AuditResourceType.ADMIN_INVITATION,
      resourceId: invitation.id,
      metadata: { email: invitation.email },
    });

    return mapInvitation(invitation);
  }

  @Mutation(() => AdminInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async revokeAdminInvitation(
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string | undefined,
    @Args('invitationId') invitationId: string,
  ): Promise<AdminInvitationType> {
    const invitation = await this.adminTeamService.revokeInvitation(invitationId);

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.ADMIN_INVITATION_REVOKED,
      resourceType: AuditResourceType.ADMIN_INVITATION,
      resourceId: invitation.id,
      metadata: { email: invitation.email },
    });

    return mapInvitation(invitation);
  }

  @Mutation(() => AdminTeamMemberType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setAdminActive(
    @CurrentUser('id') actorId: string,
    @CurrentUser('email') actorEmail: string | undefined,
    @Args('userId') userId: string,
    @Args('isActive') isActive: boolean,
  ): Promise<AdminTeamMemberType> {
    const user = await this.adminTeamService.setAdminActive(actorId, userId, isActive);

    // Enabling/disabling another admin's access is exactly the kind of privilege action
    // the audit log exists for (mirrors setCustomerActive / store suspend-reactivate).
    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId,
      actorLabel: actorEmail ?? null,
      action: AuditAction.ADMIN_STATUS_CHANGED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: { email: user.email, isActive },
    });

    return mapMember(user);
  }

  @Query(() => AdminInvitationType)
  @Public()
  async getAdminInvitationByToken(@Args('token') token: string): Promise<AdminInvitationType> {
    const invitation = await this.adminTeamService.previewInvitationByToken(token);
    return mapInvitation(invitation);
  }

  @Mutation(() => VendorAuthPayload)
  @Public()
  @UseGuards(AuthRateLimitGuard)
  async acceptAdminInvitation(
    @Args('input') input: AcceptAdminInvitationInput,
  ): Promise<VendorAuthPayload> {
    const user = await this.adminTeamService.acceptInvitation(
      input.token,
      input.password,
      input.fullName,
    );

    // Accepting the invite mints a brand-new admin account - a privilege-escalation event
    // even though it's self-service (token-based), so record it the same way verifyEmail's
    // token-based self-action does (actor is the system, not yet an authenticated admin).
    await this.auditLogsService.log({
      actorType: AuditActorType.SYSTEM,
      actorId: null,
      actorLabel: null,
      action: AuditAction.ADMIN_INVITATION_ACCEPTED,
      resourceType: AuditResourceType.USER,
      resourceId: user.id,
      metadata: { email: user.email, method: 'token' },
    });

    const result = await this.authService.login({
      email: user.email,
      password: input.password,
    });

    return {
      tokens: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      user: mapUserProfile(result.user as User),
    };
  }
}

function mapMember(user: User): AdminTeamMemberType {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

function mapInvitation(invitation: AdminInvitation): AdminInvitationType {
  return {
    id: invitation.id,
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}
