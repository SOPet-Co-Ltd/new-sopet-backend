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
    create: jest.Mock;
    save: jest.Mock;
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
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };

    service = new StoresService(
      storeRepository as never,
      userRepository as never,
      storeMemberRepository as never,
      {
        hasCredentials: jest.fn().mockReturnValue(false),
        createRecipient: jest.fn(),
        updateRecipient: jest.fn(),
      } as never,
      {
        notifyVendorAboutStoreStatus: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        deleteObject: jest.fn(),
      } as never,
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
      service.reject('store-1', { rejectionReason: 'Invalid docs' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATUS' } });
  });

  it('rejects pending store with reason', async () => {
    const pending = { id: 'store-1', ownerId: 'owner-1', status: StoreStatus.PENDING };
    storeRepository.findOne.mockResolvedValue(pending);
    storeRepository.save.mockImplementation(async (s) => s);

    const result = await service.reject('store-1', { rejectionReason: 'Invalid docs' });

    expect(result.status).toBe(StoreStatus.REJECTED);
    expect(result.rejectionReason).toBe('Invalid docs');
  });

  it('suspends store', async () => {
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', status: StoreStatus.APPROVED });
    storeRepository.save.mockImplementation(async (s) => s);

    const result = await service.suspend('store-1', 'admin-1');

    expect(result.status).toBe(StoreStatus.SUSPENDED);
  });

  it('finds store by slug', async () => {
    storeRepository.findOne.mockResolvedValue({ id: 'store-1', slug: 'my-store' });

    const store = await service.findBySlug('my-store');
    expect(store.slug).toBe('my-store');
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
});
