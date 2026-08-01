import { ConflictException, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';
import { StoreStatus } from '../../database/entities/store.entity';
import { StoreMemberRole } from '../../database/entities/store-member.entity';
import { UserRole } from '../../database/entities/user.entity';

describe('StoresService', () => {
  let service: StoresService;
  let storeRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storeMemberRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orderRepository: {
    find: jest.Mock;
  };
  let orderItemRepository: {
    createQueryBuilder: jest.Mock;
  };
  let auditLogRepository: {
    createQueryBuilder: jest.Mock;
  };
  let storeSuspensionHoldService: {
    applyHoldForStore: jest.Mock;
    restoreHoldForStore: jest.Mock;
  };
  let auditLogsService: {
    log: jest.Mock;
  };

  beforeEach(() => {
    storeRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: 'store-1' })),
    };
    userRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: 'user-1' })),
    };
    storeMemberRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    orderRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    orderItemRepository = {
      createQueryBuilder: jest.fn(),
    };
    auditLogRepository = {
      createQueryBuilder: jest.fn(() => ({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    storeSuspensionHoldService = {
      applyHoldForStore: jest.fn().mockResolvedValue({ ordersTouched: 0, itemsHeld: 0 }),
      restoreHoldForStore: jest.fn().mockResolvedValue({ ordersTouched: 0, itemsRestored: 0 }),
    };
    auditLogsService = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    service = new StoresService(
      storeRepository as never,
      userRepository as never,
      storeMemberRepository as never,
      orderRepository as never,
      orderItemRepository as never,
      auditLogRepository as never,
      {
        hasCredentials: jest.fn().mockReturnValue(false),
        createRecipient: jest.fn(),
        updateRecipient: jest.fn(),
        getRecipient: jest.fn(),
      } as never,
      {
        notifyVendorAboutStoreStatus: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        deleteObject: jest.fn(),
      } as never,
      auditLogsService as never,
      storeSuspensionHoldService as never,
    );
  });

  it('throws conflict when owner email already exists', async () => {
    userRepository.findOne.mockResolvedValue({ id: 'existing' });

    await expect(
      service.create({
        name: 'My Store',
        ownerEmail: 'exists@test.com',
        ownerPassword: 'password123',
        ownerFullName: 'Owner',
        description: 'A store',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('creates store and vendor user', async () => {
    userRepository.findOne.mockResolvedValue(null);

    const store = await service.create({
      name: 'My Store',
      ownerEmail: 'new@test.com',
      ownerPassword: 'password123',
      ownerFullName: 'Owner',
      description: 'A store',
    });

    expect(userRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserRole.VENDOR }),
    );
    expect(store.id).toBe('store-1');
    expect(store.status).toBe(StoreStatus.PENDING);
    expect(store.slug).toBe('my-store');
  });

  it('creates store with random slug for all-Thai names', async () => {
    userRepository.findOne.mockResolvedValue(null);
    storeRepository.findOne.mockResolvedValue(null);

    const store = await service.create({
      name: 'ร้านอาหารสัตว์',
      ownerEmail: 'new@test.com',
      ownerPassword: 'password123',
      ownerFullName: 'Owner',
      description: 'A store',
    });

    expect(store.slug).toMatch(/^[a-z0-9]{8}$/);
  });

  it('creates store with random slug when slugified name collides', async () => {
    userRepository.findOne.mockResolvedValue(null);
    storeRepository.findOne.mockImplementation(async (query: { where?: { slug?: string } }) => {
      if (query.where?.slug === 'my-store') {
        return { id: 'existing-store' };
      }
      return null;
    });

    const store = await service.create({
      name: 'My Store',
      ownerEmail: 'new@test.com',
      ownerPassword: 'password123',
      ownerFullName: 'Owner',
      description: 'A store',
    });

    expect(store.slug).toMatch(/^[a-z0-9]{8}$/);
    expect(store.slug).not.toBe('my-store');
  });

  it('approves only pending stores', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    await expect(service.approve('store-1', { adminId: 'admin-1' })).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS' },
    });
  });

  it('approves pending store', async () => {
    const pending = {
      id: 'store-1',
      ownerId: 'owner-1',
      status: StoreStatus.PENDING,
    };
    storeRepository.findOne.mockResolvedValue(pending);
    storeRepository.save.mockImplementation(async (s) => s);

    const result = await service.approve('store-1', { adminId: 'admin-1' });

    expect(result.status).toBe(StoreStatus.APPROVED);
    expect(result.approvedBy).toBe('admin-1');
    expect(result.approvedAt).toBeInstanceOf(Date);
  });

  it('throws when store not found', async () => {
    storeRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects non-pending store', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    await expect(
      service.reject('store-1', { adminId: 'admin-1', rejectionReason: 'Invalid docs' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS' } });
  });

  it('rejects pending store with reason', async () => {
    const pending = { id: 'store-1', ownerId: 'owner-1', status: StoreStatus.PENDING };
    storeRepository.findOne.mockResolvedValue(pending);
    storeRepository.save.mockImplementation(async (s) => s);

    const result = await service.reject('store-1', {
      adminId: 'admin-1',
      rejectionReason: 'Invalid docs',
    });

    expect(result.status).toBe(StoreStatus.REJECTED);
    expect(result.rejectionReason).toBe('Invalid docs');
  });

  it('suspends store', async () => {
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', status: StoreStatus.APPROVED });
    storeRepository.save.mockImplementation(async (s) => s);

    const result = await service.suspend('store-1', 'admin-1');

    expect(result.status).toBe(StoreStatus.SUSPENDED);
  });

  it('calls applyHoldForStore after status persist on suspend', async () => {
    const callOrder: string[] = [];
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', status: StoreStatus.APPROVED });
    storeRepository.save.mockImplementation(async (s) => {
      callOrder.push('save');
      return s;
    });
    storeSuspensionHoldService.applyHoldForStore.mockImplementation(async () => {
      callOrder.push('applyHold');
      return { ordersTouched: 1, itemsHeld: 2 };
    });

    const result = await service.suspend('store-1', 'admin-1');

    expect(result.status).toBe(StoreStatus.SUSPENDED);
    expect(storeSuspensionHoldService.applyHoldForStore).toHaveBeenCalledWith('store-1');
    expect(storeSuspensionHoldService.restoreHoldForStore).not.toHaveBeenCalled();
    expect(callOrder.indexOf('save')).toBeLessThan(callOrder.indexOf('applyHold'));
  });

  it('reactivates suspended store and calls restoreHoldForStore after status persist', async () => {
    const callOrder: string[] = [];
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', status: StoreStatus.SUSPENDED });
    storeRepository.save.mockImplementation(async (s) => {
      callOrder.push('save');
      return s;
    });
    storeSuspensionHoldService.restoreHoldForStore.mockImplementation(async () => {
      callOrder.push('restoreHold');
      return { ordersTouched: 1, itemsRestored: 2 };
    });

    const result = await service.reactivate('store-1', 'admin-1');

    expect(result.status).toBe(StoreStatus.APPROVED);
    expect(result.approvedBy).toBe('admin-1');
    expect(result.approvedAt).toBeInstanceOf(Date);
    expect(storeSuspensionHoldService.restoreHoldForStore).toHaveBeenCalledWith('store-1');
    expect(storeSuspensionHoldService.applyHoldForStore).not.toHaveBeenCalled();
    expect(callOrder.indexOf('save')).toBeLessThan(callOrder.indexOf('restoreHold'));
  });

  it('does not call restoreHoldForStore when reactivate rejects non-suspended store', async () => {
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', status: StoreStatus.APPROVED });

    await expect(service.reactivate('store-1', 'admin-1')).rejects.toMatchObject({
      response: { code: 'INVALID_STATUS' },
    });
    expect(storeRepository.save).not.toHaveBeenCalled();
    expect(storeSuspensionHoldService.restoreHoldForStore).not.toHaveBeenCalled();
  });

  it('finds store by slug', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      slug: 'my-store',
      status: StoreStatus.APPROVED,
    });

    const store = await service.findBySlug('my-store');
    expect(store.slug).toBe('my-store');
  });

  it('returns STORE_NOT_FOUND for suspended store on public findBySlug (AC-003)', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      slug: 'my-store',
      status: StoreStatus.SUSPENDED,
    });

    await expect(service.findBySlug('my-store')).rejects.toMatchObject({
      response: { code: 'STORE_NOT_FOUND' },
    });
  });

  it('returns STORE_NOT_FOUND for pending store on public findBySlug', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      slug: 'my-store',
      status: StoreStatus.PENDING,
    });

    await expect(service.findBySlug('my-store')).rejects.toMatchObject({
      response: { code: 'STORE_NOT_FOUND' },
    });
  });

  it('updates store owner and syncs loaded owner relation', async () => {
    const oldOwner = { id: 'owner-1', email: 'old@test.com', role: UserRole.VENDOR };
    const newOwner = { id: 'owner-2', email: 'new@test.com', role: UserRole.VENDOR };
    const store = {
      id: 'store-1',
      ownerId: 'owner-1',
      owner: oldOwner,
      name: 'Store',
    };
    const updatedStore = {
      ...store,
      ownerId: 'owner-2',
      owner: newOwner,
    };

    storeRepository.findOne.mockResolvedValueOnce(store).mockResolvedValueOnce(updatedStore);
    userRepository.findOne.mockResolvedValue(newOwner);
    storeRepository.save.mockImplementation(async (saved) => saved);

    const result = await service.updateAsAdmin({
      id: 'store-1',
      ownerUserId: 'owner-2',
    });

    expect(store.ownerId).toBe('owner-2');
    expect(store.owner).toBe(newOwner);
    expect(storeMemberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        userId: 'owner-2',
        role: StoreMemberRole.OWNER,
      }),
    );
    expect(result.ownerId).toBe('owner-2');
  });

  it('trims surrounding whitespace from name before saving (row 46 regression)', async () => {
    const store = { id: 'store-1', ownerId: 'owner-1', owner: { id: 'owner-1' }, name: 'Old Name' };
    storeRepository.findOne.mockResolvedValueOnce(store).mockResolvedValueOnce(store);
    storeRepository.save.mockImplementation(async (saved) => saved);

    await service.updateAsAdmin({
      id: 'store-1',
      name: '  New Name  ',
    });

    expect(store.name).toBe('New Name');
  });

  it('rejects clearing store owner', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      ownerId: 'owner-1',
      owner: { id: 'owner-1' },
    });

    await expect(
      service.updateAsAdmin({
        id: 'store-1',
        ownerUserId: null,
      }),
    ).rejects.toMatchObject({
      response: { code: 'OWNER_REQUIRED' },
    });
  });

  it('rejects unknown vendor when changing store owner', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      ownerId: 'owner-1',
      owner: { id: 'owner-1' },
    });
    userRepository.findOne.mockResolvedValue(null);

    await expect(
      service.updateAsAdmin({
        id: 'store-1',
        ownerUserId: 'missing-vendor',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('updateAsAdmin to suspended calls applyHoldForStore (admin UI path)', async () => {
    const callOrder: string[] = [];
    storeRepository.findOne
      .mockResolvedValueOnce({ id: 'store-1', status: StoreStatus.APPROVED })
      .mockResolvedValueOnce({ id: 'store-1', status: StoreStatus.SUSPENDED });
    storeRepository.save.mockImplementation(async (s) => {
      callOrder.push('save');
      return s;
    });
    storeSuspensionHoldService.applyHoldForStore.mockImplementation(async () => {
      callOrder.push('applyHold');
      return { ordersTouched: 1, itemsHeld: 1 };
    });

    const result = await service.updateAsAdmin({
      id: 'store-1',
      status: StoreStatus.SUSPENDED,
      adminId: 'admin-1',
    });

    expect(result.status).toBe(StoreStatus.SUSPENDED);
    expect(storeSuspensionHoldService.applyHoldForStore).toHaveBeenCalledWith('store-1');
    expect(storeSuspensionHoldService.restoreHoldForStore).not.toHaveBeenCalled();
    expect(callOrder.indexOf('save')).toBeLessThan(callOrder.indexOf('applyHold'));
  });

  it('updateAsAdmin suspended→approved calls restoreHoldForStore (admin UI path)', async () => {
    const callOrder: string[] = [];
    storeRepository.findOne
      .mockResolvedValueOnce({ id: 'store-1', status: StoreStatus.SUSPENDED })
      .mockResolvedValueOnce({
        id: 'store-1',
        status: StoreStatus.APPROVED,
        approvedBy: 'admin-1',
      });
    storeRepository.save.mockImplementation(async (s) => {
      callOrder.push('save');
      return s;
    });
    storeSuspensionHoldService.restoreHoldForStore.mockImplementation(async () => {
      callOrder.push('restoreHold');
      return { ordersTouched: 1, itemsRestored: 1 };
    });

    const result = await service.updateAsAdmin({
      id: 'store-1',
      status: StoreStatus.APPROVED,
      adminId: 'admin-1',
    });

    expect(result.status).toBe(StoreStatus.APPROVED);
    expect(storeSuspensionHoldService.restoreHoldForStore).toHaveBeenCalledWith('store-1');
    expect(storeSuspensionHoldService.applyHoldForStore).not.toHaveBeenCalled();
    expect(callOrder.indexOf('save')).toBeLessThan(callOrder.indexOf('restoreHold'));
  });

  it('updateAsAdmin without status change does not call hold hooks', async () => {
    storeRepository.findOne
      .mockResolvedValueOnce({ id: 'store-1', status: StoreStatus.APPROVED, name: 'Old' })
      .mockResolvedValueOnce({ id: 'store-1', status: StoreStatus.APPROVED, name: 'New' });
    storeRepository.save.mockImplementation(async (s) => s);

    await service.updateAsAdmin({
      id: 'store-1',
      name: 'New',
      adminId: 'admin-1',
    });

    expect(storeSuspensionHoldService.applyHoldForStore).not.toHaveBeenCalled();
    expect(storeSuspensionHoldService.restoreHoldForStore).not.toHaveBeenCalled();
  });

  describe('getVendorInsightsForAdmin', () => {
    it('returns revenue stats, memberships, and synthesized activities', async () => {
      const vendor = {
        id: 'vendor-1',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        lastLoginAt: new Date('2026-01-10T08:00:00Z'),
        ownedStores: [
          {
            id: 'store-1',
            name: 'Pet Shop',
            slug: 'pet-shop',
            status: StoreStatus.APPROVED,
            createdAt: new Date('2025-02-01T00:00:00Z'),
          },
        ],
      };
      userRepository.findOne.mockResolvedValue(vendor);

      const statsQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          orderCount: '3',
          totalRevenue: '4500',
          lastOrderAt: new Date('2026-01-08T12:00:00Z'),
        }),
        getRawMany: jest.fn().mockResolvedValue([{ id: 'order-1' }]),
      };
      orderItemRepository.createQueryBuilder.mockReturnValue(statsQb);

      orderRepository.find.mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: 'paid',
          total: 1500,
          createdAt: new Date('2026-01-08T12:00:00Z'),
          items: [
            {
              productName: 'Dog Food',
              quantity: 1,
              unitPrice: 1500,
              subtotal: 1500,
            },
          ],
        },
      ]);

      storeMemberRepository.find.mockResolvedValue([
        {
          storeId: 'store-2',
          role: StoreMemberRole.STAFF,
          createdAt: new Date('2025-06-01T00:00:00Z'),
          store: {
            id: 'store-2',
            name: 'Partner Store',
            slug: 'partner-store',
            status: StoreStatus.APPROVED,
            ownerId: 'other-vendor',
          },
        },
      ]);

      const result = await service.getVendorInsightsForAdmin('vendor-1');

      expect(result.storeCount).toBe(1);
      expect(result.membershipCount).toBe(1);
      expect(result.totalRevenue).toBe(4500);
      expect(result.orderCount).toBe(3);
      expect(result.averageOrderValue).toBe(1500);
      expect(result.memberships[0].storeName).toBe('Partner Store');
      expect(result.recentOrders).toHaveLength(1);
      expect(result.activities.some((activity) => activity.kind === 'store_created')).toBe(true);
      expect(result.activities.some((activity) => activity.kind === 'membership_joined')).toBe(
        true,
      );
    });

    it('throws NotFound when vendor does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getVendorInsightsForAdmin('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
