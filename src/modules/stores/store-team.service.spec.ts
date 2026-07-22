jest.mock('../../database/entities/store-member.entity', () => ({
  StoreMemberRole: {
    OWNER: 'owner',
    MANAGER: 'manager',
    STAFF: 'staff',
  },
  StoreMember: class StoreMember {},
}));

jest.mock('../../database/entities/store-member-invitation.entity', () => ({
  StoreMemberInvitationStatus: {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
  },
  StoreMemberInvitation: class StoreMemberInvitation {},
}));

jest.mock('../../database/entities/user.entity', () => ({
  UserRole: {
    ADMIN: 'admin',
    VENDOR: 'vendor',
    CUSTOMER: 'customer',
  },
  User: class User {},
}));

jest.mock('../../database/entities/store.entity', () => ({
  Store: class Store {},
}));

jest.mock('../email/email-delivery.service', () => ({
  EmailDeliveryService: class EmailDeliveryService {},
}));

import { StoreTeamService } from './store-team.service';
import { StoreMemberInvitationStatus } from '../../database/entities/store-member-invitation.entity';

describe('StoreTeamService', () => {
  let service: StoreTeamService;
  let invitationRepository: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let queryBuilder: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
  };

  beforeEach(() => {
    queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    invitationRepository = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };

    service = new StoreTeamService(
      {} as never,
      invitationRepository as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  describe('listPendingInvitationsForEmail', () => {
    it('filters by normalized email, pending status, and non-expired expiry', async () => {
      const invitations = [
        {
          id: 'inv-1',
          email: 'vendor@example.com',
          status: StoreMemberInvitationStatus.PENDING,
          store: { name: 'Pet Shop' },
        },
      ];
      queryBuilder.getMany.mockResolvedValue(invitations);

      const result = await service.listPendingInvitationsForEmail('Vendor@Example.com');

      expect(invitationRepository.createQueryBuilder).toHaveBeenCalledWith('invitation');
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('invitation.store', 'store');
      expect(queryBuilder.where).toHaveBeenCalledWith('LOWER(invitation.email) = :email', {
        email: 'vendor@example.com',
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('invitation.status = :status', {
        status: StoreMemberInvitationStatus.PENDING,
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'invitation.expiresAt > :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('invitation.createdAt', 'DESC');
      expect(result).toEqual(invitations);
    });

    it('returns empty list when no invitations match', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      const result = await service.listPendingInvitationsForEmail('nobody@example.com');

      expect(result).toEqual([]);
    });
  });
});
