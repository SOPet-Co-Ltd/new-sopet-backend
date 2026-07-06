import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { StoreReactivationRequestService } from './store-reactivation-request.service';
import { StoreReactivationRequestStatus } from '../../database/entities/store-reactivation-request.entity';
import { StoreStatus } from '../../database/entities/store.entity';
import { StoresService } from './stores.service';

describe('StoreReactivationRequestService', () => {
  let service: StoreReactivationRequestService;
  let requestRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let imageRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let storeRepository: {
    findOne: jest.Mock;
  };
  let storesService: {
    userHasStoreManagerAccess: jest.Mock;
    reactivate: jest.Mock;
  };

  beforeEach(() => {
    requestRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => ({ id: 'req-1', ...data })),
      save: jest.fn(async (data) => data),
      find: jest.fn().mockResolvedValue([]),
    };
    imageRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    storeRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'store-1',
        status: StoreStatus.SUSPENDED,
      }),
    };
    storesService = {
      userHasStoreManagerAccess: jest.fn().mockResolvedValue(true),
      reactivate: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };

    service = new StoreReactivationRequestService(
      requestRepository as never,
      imageRepository as never,
      storeRepository as never,
      storesService as unknown as StoresService,
    );

    requestRepository.findOne.mockImplementation(async (options) => {
      const where = options?.where as Record<string, unknown> | undefined;
      if (where?.status === StoreReactivationRequestStatus.PENDING) {
        return null;
      }
      if (where?.id === 'req-1') {
        return {
          id: 'req-1',
          storeId: 'store-1',
          title: 'Please restore',
          content: 'We fixed the issue',
          status: StoreReactivationRequestStatus.PENDING,
          images: [],
          store: { name: 'Shop' },
          submittedBy: { fullName: 'Owner', email: 'o@test.com' },
        };
      }
      return null;
    });
  });

  it('submits a reactivation request for a suspended store', async () => {
    const result = await service.submit('user-1', {
      storeId: 'store-1',
      title: 'Please restore',
      content: 'We fixed the issue',
      mediaUrls: ['https://cdn.example.com/a.webp'],
    });

    expect(result.title).toBe('Please restore');
    expect(imageRepository.save).toHaveBeenCalled();
  });

  it('rejects submit when store is not suspended', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    await expect(
      service.submit('user-1', {
        storeId: 'store-1',
        title: 'Title',
        content: 'Content',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects submit when user lacks manager access', async () => {
    storesService.userHasStoreManagerAccess.mockResolvedValue(false);

    await expect(
      service.submit('user-1', {
        storeId: 'store-1',
        title: 'Title',
        content: 'Content',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects duplicate pending requests', async () => {
    requestRepository.findOne.mockResolvedValueOnce({
      id: 'pending-1',
      status: StoreReactivationRequestStatus.PENDING,
    });

    await expect(
      service.submit('user-1', {
        storeId: 'store-1',
        title: 'Title',
        content: 'Content',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('approves and reactivates the store', async () => {
    const result = await service.approve('req-1', 'admin-1');

    expect(storesService.reactivate).toHaveBeenCalledWith('store-1', 'admin-1');
    expect(result.status).toBe(StoreReactivationRequestStatus.APPROVED);
  });
});
