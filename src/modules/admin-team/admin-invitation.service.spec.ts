import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminInvitationService } from './admin-invitation.service';
import { AdminInvitationStatus } from '../../database/entities/admin-invitation.entity';
import { UserRole } from '../../database/entities/user.entity';

describe('AdminInvitationService', () => {
  let service: AdminInvitationService;
  let invitationRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  const pendingInvitation = {
    id: 'inv-1',
    email: 'newadmin@sopet.org',
    token: 'valid-token',
    status: AdminInvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    invitedBy: 'admin-1',
  };

  beforeEach(() => {
    invitationRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ id: 'inv-1', ...data })),
      save: jest.fn(async (data) => data),
      find: jest.fn().mockResolvedValue([]),
    };
    userRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'user-1', ...data })),
    };

    service = new AdminInvitationService(invitationRepository as never, userRepository as never);
  });

  describe('invite', () => {
    it('rejects inviting an email that already has an account', async () => {
      userRepository.findOne.mockResolvedValue({ id: 'user-1' });

      await expect(service.invite('taken@sopet.org', 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('rejects inviting an email with an existing pending invitation', async () => {
      invitationRepository.findOne.mockResolvedValue(pendingInvitation);

      await expect(service.invite('newadmin@sopet.org', 'admin-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('previewByToken', () => {
    it('returns the invitation for a valid token so the accept page can show the invited email', async () => {
      invitationRepository.findOne.mockResolvedValue(pendingInvitation);

      const result = await service.previewByToken('valid-token');

      expect(result.email).toBe('newadmin@sopet.org');
    });

    it('throws NotFoundException for an unknown token', async () => {
      invitationRepository.findOne.mockResolvedValue(null);

      await expect(service.previewByToken('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('accept', () => {
    it('creates a user with ADMIN role and marks the invitation accepted', async () => {
      invitationRepository.findOne.mockResolvedValue({ ...pendingInvitation });

      await service.accept('valid-token', 'Password123', 'New Admin');

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'newadmin@sopet.org', role: UserRole.ADMIN }),
      );
      expect(invitationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AdminInvitationStatus.ACCEPTED }),
      );
    });

    it('rejects accepting an unknown token', async () => {
      invitationRepository.findOne.mockResolvedValue(null);

      await expect(service.accept('missing', 'Password123', 'New Admin')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects accepting an already-accepted invitation', async () => {
      invitationRepository.findOne.mockResolvedValue({
        ...pendingInvitation,
        status: AdminInvitationStatus.ACCEPTED,
      });

      await expect(service.accept('valid-token', 'Password123', 'New Admin')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects and expires an invitation past its expiry date', async () => {
      invitationRepository.findOne.mockResolvedValue({
        ...pendingInvitation,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      await expect(service.accept('valid-token', 'Password123', 'New Admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(invitationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: AdminInvitationStatus.EXPIRED }),
      );
    });
  });
});
