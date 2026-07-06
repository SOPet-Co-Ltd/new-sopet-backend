import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { AdminInvitation } from '../../database/entities/admin-invitation.entity';
import { AdminInvitationService } from './admin-invitation.service';
import { AdminTeamService } from './admin-team.service';
import { AdminTeamResolver } from './admin-team.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([User, AdminInvitation])],
  providers: [AdminInvitationService, AdminTeamService, AdminTeamResolver],
  exports: [AdminInvitationService, AdminTeamService],
})
export class AdminTeamModule {}
