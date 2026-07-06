import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  AdminInvitation,
  AdminInvitationStatus,
} from '../../database/entities/admin-invitation.entity';
import { User, UserRole } from '../../database/entities/user.entity';

@Injectable()
export class AdminInvitationService {
  constructor(
    @InjectRepository(AdminInvitation)
    private readonly invitationRepository: Repository<AdminInvitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async invite(email: string, invitedBy: string): Promise<AdminInvitation> {
    const normalizedEmail = email.toLowerCase();

    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already registered',
      });
    }

    const pending = await this.invitationRepository.findOne({
      where: {
        email: normalizedEmail,
        status: AdminInvitationStatus.PENDING,
      },
    });
    if (pending) {
      throw new ConflictException({
        code: 'INVITATION_EXISTS',
        message: 'A pending invitation already exists for this email',
      });
    }

    const invitation = this.invitationRepository.create({
      email: normalizedEmail,
      token: randomBytes(32).toString('hex'),
      invitedBy,
      status: AdminInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return this.invitationRepository.save(invitation);
  }

  async findPending(): Promise<AdminInvitation[]> {
    return this.invitationRepository.find({
      where: { status: AdminInvitationStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async revoke(invitationId: string): Promise<AdminInvitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { id: invitationId },
    });
    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (invitation.status !== AdminInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer pending',
      });
    }
    invitation.status = AdminInvitationStatus.REVOKED;
    return this.invitationRepository.save(invitation);
  }

  async accept(token: string, password: string, fullName: string): Promise<User> {
    const invitation = await this.invitationRepository.findOne({
      where: { token },
    });

    if (!invitation) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }

    if (invitation.status !== AdminInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid',
      });
    }

    if (invitation.expiresAt < new Date()) {
      invitation.status = AdminInvitationStatus.EXPIRED;
      await this.invitationRepository.save(invitation);
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = this.userRepository.create({
      email: invitation.email,
      passwordHash,
      fullName,
      role: UserRole.ADMIN,
    });
    const savedUser = await this.userRepository.save(user);

    invitation.status = AdminInvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    await this.invitationRepository.save(invitation);

    return savedUser;
  }
}
