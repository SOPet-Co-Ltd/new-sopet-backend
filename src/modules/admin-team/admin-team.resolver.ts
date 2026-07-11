import { Args, Field, InputType, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsEmail } from 'class-validator';
import { AdminTeamService } from './admin-team.service';
import { AdminInvitationType, AdminTeamMemberType } from '../../graphql/models/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { AdminInvitation } from '../../database/entities/admin-invitation.entity';
import { User } from '../../database/entities/user.entity';

@InputType()
export class InviteAdminInput {
  @Field()
  @IsEmail()
  email: string;
}

@Resolver()
export class AdminTeamResolver {
  constructor(private readonly adminTeamService: AdminTeamService) {}

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
    @Args('input') input: InviteAdminInput,
  ): Promise<AdminInvitationType> {
    const invitation = await this.adminTeamService.invite(input.email, adminId);
    return mapInvitation(invitation);
  }

  @Mutation(() => AdminInvitationType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async revokeAdminInvitation(
    @Args('invitationId') invitationId: string,
  ): Promise<AdminInvitationType> {
    const invitation = await this.adminTeamService.revokeInvitation(invitationId);
    return mapInvitation(invitation);
  }

  @Mutation(() => AdminTeamMemberType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async setAdminActive(
    @CurrentUser('id') actorId: string,
    @Args('userId') userId: string,
    @Args('isActive') isActive: boolean,
  ): Promise<AdminTeamMemberType> {
    const user = await this.adminTeamService.setAdminActive(actorId, userId, isActive);
    return mapMember(user);
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
