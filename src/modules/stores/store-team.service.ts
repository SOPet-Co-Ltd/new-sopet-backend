import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { StoreMember, StoreMemberRole } from '../../database/entities/store-member.entity';
import {
  StoreMemberInvitation,
  StoreMemberInvitationStatus,
} from '../../database/entities/store-member-invitation.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { Store } from '../../database/entities/store.entity';
import { EmailDeliveryService } from '../email/email-delivery.service';

@Injectable()
export class StoreTeamService {
  constructor(
    @InjectRepository(StoreMember)
    private readonly memberRepository: Repository<StoreMember>,
    @InjectRepository(StoreMemberInvitation)
    private readonly invitationRepository: Repository<StoreMemberInvitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly emailDeliveryService: EmailDeliveryService,
  ) {}

  async inviteMember(
    storeId: string,
    invitedBy: string,
    email: string,
    role: StoreMemberRole,
  ): Promise<StoreMemberInvitation> {
    if (role === StoreMemberRole.OWNER) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message: 'Cannot invite members with the owner role',
      });
    }

    const normalizedEmail = email.toLowerCase();

    const existingMember = await this.memberRepository
      .createQueryBuilder('member')
      .innerJoin('member.user', 'user')
      .where('member.storeId = :storeId', { storeId })
      .andWhere('LOWER(user.email) = :email', { email: normalizedEmail })
      .getOne();

    if (existingMember) {
      throw new ConflictException({
        code: 'MEMBER_EXISTS',
        message: 'User is already a member of this store',
      });
    }

    const pendingInvitation = await this.invitationRepository.findOne({
      where: {
        storeId,
        email: normalizedEmail,
        status: StoreMemberInvitationStatus.PENDING,
      },
    });

    if (pendingInvitation) {
      throw new ConflictException({
        code: 'INVITATION_EXISTS',
        message: 'A pending invitation already exists for this email',
      });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = this.invitationRepository.create({
      storeId,
      invitedBy,
      email: normalizedEmail,
      role,
      token,
      status: StoreMemberInvitationStatus.PENDING,
      expiresAt,
    });

    const saved = await this.invitationRepository.save(invitation);

    const store = await this.storeRepository.findOne({
      where: { id: storeId },
    });
    await this.emailDeliveryService.sendStoreMemberInvite(
      saved.email,
      saved.token,
      storeId,
      store?.name ?? 'ร้านค้า',
    );

    return saved;
  }

  async getInvitationByToken(token: string): Promise<{
    storeName: string;
    email: string;
    role: StoreMemberRole;
    expiresAt: Date;
    userExists: boolean;
  }> {
    const invitation = await this.findValidPendingInvitation(token);
    const store = await this.storeRepository.findOne({
      where: { id: invitation.storeId },
    });

    const existingUser = await this.userRepository.findOne({
      where: { email: invitation.email },
    });

    return {
      storeName: store?.name ?? 'ร้านค้า',
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      userExists: !!existingUser,
    };
  }

  async acceptInvitationAsNewUser(
    token: string,
    password: string,
    fullName: string,
  ): Promise<StoreMember> {
    const invitation = await this.findValidPendingInvitation(token);

    const existingUser = await this.userRepository.findOne({
      where: { email: invitation.email },
    });
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already registered — please log in to accept this invitation',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = this.userRepository.create({
      email: invitation.email,
      passwordHash,
      fullName,
      role: UserRole.VENDOR,
    });
    const savedUser = await this.userRepository.save(user);

    return this.acceptInvitation(token, savedUser.id);
  }

  private async findValidPendingInvitation(token: string): Promise<StoreMemberInvitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== StoreMemberInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid',
      });
    }

    if (invitation.expiresAt < new Date()) {
      invitation.status = StoreMemberInvitationStatus.EXPIRED;
      await this.invitationRepository.save(invitation);
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      });
    }

    return invitation;
  }

  async acceptInvitation(token: string, userId: string): Promise<StoreMember> {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== StoreMemberInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid',
      });
    }

    if (invitation.expiresAt < new Date()) {
      invitation.status = StoreMemberInvitationStatus.EXPIRED;
      await this.invitationRepository.save(invitation);
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      });
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException({
        code: 'EMAIL_MISMATCH',
        message: 'Invitation email does not match your account',
      });
    }

    const existingMember = await this.memberRepository.findOne({
      where: { storeId: invitation.storeId, userId },
    });

    if (existingMember) {
      throw new ConflictException({
        code: 'MEMBER_EXISTS',
        message: 'You are already a member of this store',
      });
    }

    const member = this.memberRepository.create({
      storeId: invitation.storeId,
      userId,
      role: invitation.role,
    });
    const savedMember = await this.memberRepository.save(member);

    invitation.status = StoreMemberInvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    await this.invitationRepository.save(invitation);

    return this.memberRepository.findOneOrFail({
      where: { id: savedMember.id },
      relations: ['user'],
    });
  }

  async listMembers(storeId: string): Promise<StoreMember[]> {
    return this.memberRepository.find({
      where: { storeId },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async listInvitations(storeId: string): Promise<StoreMemberInvitation[]> {
    return this.invitationRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async listPendingInvitations(storeId: string): Promise<StoreMemberInvitation[]> {
    return this.invitationRepository.find({
      where: { storeId, status: StoreMemberInvitationStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async updateMemberRole(
    storeId: string,
    memberId: string,
    role: StoreMemberRole,
  ): Promise<StoreMember> {
    if (role !== StoreMemberRole.MANAGER && role !== StoreMemberRole.STAFF) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message: 'Role must be manager or staff',
      });
    }

    const member = await this.memberRepository.findOne({
      where: { id: memberId, storeId },
      relations: ['user'],
    });

    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Store member not found',
      });
    }

    if (member.role === StoreMemberRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWNER',
        message: 'Cannot change the store owner role',
      });
    }

    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (store?.ownerId === member.userId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWNER',
        message: 'Cannot change the store owner role',
      });
    }

    member.role = role;
    const saved = await this.memberRepository.save(member);
    return this.memberRepository.findOneOrFail({
      where: { id: saved.id },
      relations: ['user'],
    });
  }

  async removeMember(storeId: string, memberId: string): Promise<void> {
    const member = await this.memberRepository.findOne({
      where: { id: memberId, storeId },
    });

    if (!member) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Store member not found',
      });
    }

    if (member.role === StoreMemberRole.OWNER) {
      throw new BadRequestException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'Cannot remove the store owner',
      });
    }

    await this.memberRepository.remove(member);
  }

  async revokeInvitation(storeId: string, invitationId: string): Promise<StoreMemberInvitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId, storeId },
    });

    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== StoreMemberInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_NOT_PENDING',
        message: 'Only pending invitations can be revoked',
      });
    }

    invitation.status = StoreMemberInvitationStatus.REVOKED;
    return this.invitationRepository.save(invitation);
  }

  async declineInvitation(token: string, userId: string): Promise<void> {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== StoreMemberInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid',
      });
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }

    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException({
        code: 'EMAIL_MISMATCH',
        message: 'Invitation email does not match your account',
      });
    }

    await this.invitationRepository.remove(invitation);
  }
}
