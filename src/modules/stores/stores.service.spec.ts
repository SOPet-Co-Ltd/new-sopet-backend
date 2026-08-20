import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { StoresService } from './stores.service';
import { StoreStatus } from '../../database/entities/store.entity';
import { StoreMemberRole } from '../../database/entities/store-member.entity';
import { UserRole } from '../../database/entities/user.entity';
import { mapAdminStore } from '../../graphql/models/mappers';

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
  let emailDeliveryService: {
    sendVendorAccountSuspended: jest.Mock;
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
    emailDeliveryService = {
      sendVendorAccountSuspended: jest.fn().mockResolvedValue(undefined),
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
      emailDeliveryService as never,
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

  it('returns approved store on findOneForDiscovery for anonymous viewers', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    const store = await service.findOneForDiscovery('store-1');
    expect(store.status).toBe(StoreStatus.APPROVED);
  });

  it('returns STORE_NOT_FOUND for pending store on findOneForDiscovery without access', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.PENDING,
    });

    await expect(service.findOneForDiscovery('store-1')).rejects.toMatchObject({
      response: { code: 'STORE_NOT_FOUND' },
    });
  });

  it('allows vendor with store access to view pending store by id', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.PENDING,
    });
    storeRepository.findOne.mockResolvedValueOnce({
      id: 'store-1',
      ownerId: 'vendor-1',
    });

    jest.spyOn(service, 'userHasStoreAccess').mockResolvedValue(true);

    const store = await service.findOneForDiscovery('store-1', {
      userId: 'vendor-1',
      role: 'vendor',
    });
    expect(store.id).toBe('store-1');
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

  describe('updateAsAdmin commissionRate', () => {
    const loadStore = (commissionRate: number | null) => {
      const store = {
        id: 'store-1',
        ownerId: 'owner-1',
        name: 'Pet Shop',
        status: StoreStatus.APPROVED,
        commissionRate,
      };
      storeRepository.findOne.mockImplementation(() => Promise.resolve(store));
      storeRepository.save.mockImplementation((saved) => Promise.resolve(saved));
      return store;
    };

    it('persists 0 as custom 0 when the column was NULL', async () => {
      const store = loadStore(null);

      const result = await service.updateAsAdmin({ id: 'store-1', commissionRate: 0 });

      expect(store.commissionRate).toBe(0);
      expect(result.commissionRate).toBe(0);
      expect(storeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'store-1', commissionRate: 0 }),
      );
    });

    it('persists 5 and leaves an omitted rate unchanged', async () => {
      const store = loadStore(null);

      await service.updateAsAdmin({ id: 'store-1', commissionRate: 5 });
      expect(store.commissionRate).toBe(5);

      await service.updateAsAdmin({ id: 'store-1', name: 'Renamed' });
      expect(store.commissionRate).toBe(5);
      expect(store.name).toBe('Renamed');
    });

    it('persists explicit 7 as custom 7', async () => {
      const store = loadStore(null);

      await service.updateAsAdmin({ id: 'store-1', commissionRate: 7 });

      expect(store.commissionRate).toBe(7);
    });

    it('leaves NULL when commissionRate is omitted', async () => {
      const store = loadStore(null);

      await service.updateAsAdmin({ id: 'store-1', name: 'Still Null Rate' });

      expect(store.commissionRate).toBeNull();
    });

    it('rejects 101 with INVALID_COMMISSION_RATE and does not write', async () => {
      const store = loadStore(5);

      await expect(
        service.updateAsAdmin({ id: 'store-1', commissionRate: 101 }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_COMMISSION_RATE' },
      });
      expect(store.commissionRate).toBe(5);
      expect(storeRepository.save).not.toHaveBeenCalled();
    });

    it('rejects 7.5 with INVALID_COMMISSION_RATE and does not write', async () => {
      const store = loadStore(5);

      await expect(
        service.updateAsAdmin({ id: 'store-1', commissionRate: 7.5 }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_COMMISSION_RATE' },
      });
      expect(store.commissionRate).toBe(5);
      expect(storeRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a non-integer with INVALID_COMMISSION_RATE and does not write', async () => {
      const store = loadStore(5);

      await expect(
        service.updateAsAdmin({ id: 'store-1', commissionRate: '10' as unknown as number }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_COMMISSION_RATE' },
      });
      expect(store.commissionRate).toBe(5);
      expect(storeRepository.save).not.toHaveBeenCalled();
    });

    it('emits INFO with storeId, old, and new on successful persist and no PII', async () => {
      loadStore(null);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.updateAsAdmin({ id: 'store-1', commissionRate: 0 });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('store-1'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/old=null/));
      expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/new=0/));
      const message = logSpy.mock.calls.map((call) => String(call[0])).join(' ');
      expect(message).not.toMatch(/Pet Shop|jwt|Bearer|@/i);
      logSpy.mockRestore();
    });

    it('does not emit a rate-change INFO when the rate is rejected', async () => {
      loadStore(5);
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await expect(
        service.updateAsAdmin({ id: 'store-1', commissionRate: 101 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(logSpy).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  describe('mapAdminStore commissionRate', () => {
    const baseStore = {
      id: 'store-1',
      ownerId: 'owner-1',
      name: 'Pet Shop',
      slug: 'pet-shop',
      description: null,
      logoUrl: null,
      bannerUrl: null,
      status: StoreStatus.APPROVED,
      contactPhone: null,
      contactEmail: null,
      address: null,
      bankAccountName: null,
      bankAccountNumber: null,
      bankName: null,
      payoutSchedule: 'manual',
      payoutSchedulePaused: false,
      owner: undefined,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };

    it('preserves SQL NULL as null and does not substitute 7', () => {
      const mapped = mapAdminStore({ ...baseStore, commissionRate: null } as never);
      expect(mapped.commissionRate).toBeNull();
    });

    it('maps 0 as 0', () => {
      const mapped = mapAdminStore({ ...baseStore, commissionRate: 0 } as never);
      expect(mapped.commissionRate).toBe(0);
    });

    it('maps custom 7 as 7', () => {
      const mapped = mapAdminStore({ ...baseStore, commissionRate: 7 } as never);
      expect(mapped.commissionRate).toBe(7);
    });
  });

  describe('updateVendorAsAdmin', () => {
    it('sends suspension email once when vendor account becomes inactive', async () => {
      const vendor = {
        id: 'vendor-1',
        email: 'vendor@test.com',
        fullName: 'Vendor One',
        isActive: true,
        role: UserRole.VENDOR,
        ownedStores: [{ id: 'store-1', name: 'Pet Shop' }],
      };
      userRepository.findOne.mockResolvedValue(vendor);
      userRepository.save.mockImplementation(async (data) => data);

      const result = await service.updateVendorAsAdmin({ id: 'vendor-1', isActive: false });

      expect(result.isActive).toBe(false);
      expect(emailDeliveryService.sendVendorAccountSuspended).toHaveBeenCalledTimes(1);
      expect(emailDeliveryService.sendVendorAccountSuspended).toHaveBeenCalledWith(
        'vendor@test.com',
        {
          vendorName: 'Vendor One',
          storeName: 'Pet Shop',
        },
      );
    });

    it('does not send suspension email when vendor is already inactive', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'vendor-1',
        email: 'vendor@test.com',
        fullName: 'Vendor One',
        isActive: false,
        role: UserRole.VENDOR,
        ownedStores: [],
      });
      userRepository.save.mockImplementation(async (data) => data);

      await service.updateVendorAsAdmin({ id: 'vendor-1', isActive: false });

      expect(emailDeliveryService.sendVendorAccountSuspended).not.toHaveBeenCalled();
    });

    it('does not send suspension email when reactivating a vendor', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'vendor-1',
        email: 'vendor@test.com',
        fullName: 'Vendor One',
        isActive: false,
        role: UserRole.VENDOR,
        ownedStores: [],
      });
      userRepository.save.mockImplementation(async (data) => data);

      await service.updateVendorAsAdmin({ id: 'vendor-1', isActive: true });

      expect(emailDeliveryService.sendVendorAccountSuspended).not.toHaveBeenCalled();
    });

    it('does not send suspension email when updating profile without status change', async () => {
      userRepository.findOne
        .mockResolvedValueOnce({
          id: 'vendor-1',
          email: 'vendor@test.com',
          fullName: 'Old Name',
          isActive: true,
          role: UserRole.VENDOR,
          ownedStores: [],
        })
        .mockResolvedValueOnce(null);
      userRepository.save.mockImplementation(async (data) => data);

      await service.updateVendorAsAdmin({ id: 'vendor-1', fullName: 'New Name' });

      expect(emailDeliveryService.sendVendorAccountSuspended).not.toHaveBeenCalled();
    });
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

  describe('Omise payout bank change', () => {
    it('resets Omise status when bank details change', async () => {
      const { OmiseRecipientStatus } = await import('../../database/entities/store.entity');
      storeRepository.findOne.mockResolvedValue({
        id: 'store-1',
        bankAccountName: 'Old Name',
        bankAccountNumber: '1111111111',
        bankName: 'ธนาคารกสิกรไทย',
        bankCode: 'kbank',
        omiseRecipientId: 'recp_old',
        omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
        omiseRecipientFailureMessage: null,
      });

      const saved = await service.updateStorePayout('store-1', {
        bankAccountName: 'New Name',
        bankAccountNumber: '2222222222',
        bankName: 'ธนาคารกรุงศรีอยุธยา',
        bankCode: 'bay',
      });

      expect(saved.omiseRecipientStatus).toBe(OmiseRecipientStatus.NOT_CONNECTED);
      expect(storeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          omiseRecipientStatus: OmiseRecipientStatus.NOT_CONNECTED,
          bankAccountNumber: '2222222222',
        }),
      );
    });

    it('does not refresh Omise status while NOT_CONNECTED after bank change', async () => {
      const { OmiseRecipientStatus } = await import('../../database/entities/store.entity');
      const getRecipient = jest.fn().mockResolvedValue({ verified: true, active: true });
      const omiseService = {
        hasCredentials: jest.fn().mockReturnValue(true),
        createRecipient: jest.fn(),
        updateRecipient: jest.fn(),
        getRecipient,
      };

      service = new StoresService(
        storeRepository as never,
        userRepository as never,
        storeMemberRepository as never,
        orderRepository as never,
        orderItemRepository as never,
        auditLogRepository as never,
        omiseService as never,
        {
          notifyVendorAboutStoreStatus: jest.fn().mockResolvedValue(undefined),
        } as never,
        {
          deleteObject: jest.fn(),
        } as never,
        auditLogsService as never,
        storeSuspensionHoldService as never,
        emailDeliveryService as never,
      );

      storeRepository.findOne.mockResolvedValue({
        id: 'store-1',
        omiseRecipientId: 'recp_old',
        omiseRecipientStatus: OmiseRecipientStatus.NOT_CONNECTED,
      });

      const result = await service.refreshOmiseRecipientStatus('store-1');

      expect(getRecipient).not.toHaveBeenCalled();
      expect(result.omiseRecipientStatus).toBe(OmiseRecipientStatus.NOT_CONNECTED);
      expect(storeRepository.save).not.toHaveBeenCalled();
    });
  });
});
