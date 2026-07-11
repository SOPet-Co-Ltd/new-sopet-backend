import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../../database/entities/user.entity';
import { AdminInvitationService } from './admin-invitation.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { AdminInvitation } from '../../database/entities/admin-invitation.entity';

@Injectable()
export class AdminTeamService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly adminInvitationService: AdminInvitationService,
    private readonly emailDelivery: EmailDeliveryService,
  ) {}

  async listMembers(): Promise<User[]> {
    return this.userRepository.find({
      where: { role: UserRole.ADMIN },
      order: { createdAt: 'ASC' },
    });
  }

  async invite(email: string, invitedBy: string): Promise<AdminInvitation> {
    const invitation = await this.adminInvitationService.invite(email, invitedBy);
    await this.emailDelivery.sendAdminInvite(invitation.email, invitation.token);
    return invitation;
  }

  async findPendingInvitations(): Promise<AdminInvitation[]> {
    return this.adminInvitationService.findPending();
  }

  async revokeInvitation(invitationId: string): Promise<AdminInvitation> {
    return this.adminInvitationService.revoke(invitationId);
  }

  async setAdminActive(actorId: string, userId: string, isActive: boolean): Promise<User> {
    if (actorId === userId && !isActive) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You cannot deactivate your own account',
      });
    }

    const user = await this.userRepository.findOne({
      where: { id: userId, role: UserRole.ADMIN },
    });
    if (!user) {
      throw new NotFoundException({
        code: 'ADMIN_NOT_FOUND',
        message: 'Admin user not found',
      });
    }

    user.isActive = isActive;
    return this.userRepository.save(user);
  }
}
