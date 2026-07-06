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
  VendorInvitation,
  VendorInvitationStatus,
} from '../../database/entities/vendor-invitation.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { EmailDeliveryService } from '../email/email-delivery.service';

@Injectable()
export class VendorInvitationService {
  constructor(
    @InjectRepository(VendorInvitation)
    private readonly invitationRepository: Repository<VendorInvitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly emailDeliveryService: EmailDeliveryService,
  ) {}

  async invite(email: string, invitedBy: string): Promise<VendorInvitation> {
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
        status: VendorInvitationStatus.PENDING,
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
      status: VendorInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const saved = await this.invitationRepository.save(invitation);
    await this.emailDeliveryService.sendVendorInvite(saved.email, saved.token);
    return saved;
  }

  async findPending(): Promise<VendorInvitation[]> {
    return this.invitationRepository.find({
      where: { status: VendorInvitationStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
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

    if (invitation.status !== VendorInvitationStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVITATION_INVALID',
        message: 'Invitation is no longer valid',
      });
    }

    if (invitation.expiresAt < new Date()) {
      invitation.status = VendorInvitationStatus.EXPIRED;
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
      role: UserRole.VENDOR,
    });
    const savedUser = await this.userRepository.save(user);

    invitation.status = VendorInvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    await this.invitationRepository.save(invitation);

    return savedUser;
  }
}
