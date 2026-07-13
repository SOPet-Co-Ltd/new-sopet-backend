import { ConflictException, ForbiddenException } from '@nestjs/common';
import { StoreRequestService } from './store-request.service';
import { StoreRequestStatus } from '../../database/entities/store-request.entity';
import { StoreStatus } from '../../database/entities/store.entity';
import { StoreMemberRole } from '../../database/entities/store-member.entity';

describe('StoreRequestService', () => {
  let service: StoreRequestService;
  let storeRequestRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
  };
  let storeRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storeMemberRepository: {
    create: jest.Mock;
    save: jest.Mock;
  };
  let userRepository: {
    findOne: jest.Mock;
  };
  let notificationsService: {
    notifyAdminAboutNewRequest: jest.Mock;
    notifyVendorAboutRequestStatus: jest.Mock;
  };
  let storageService: {
    assertFolderImageUrl: jest.Mock;
  };

  beforeEach(() => {
    storeRequestRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => ({ id: 'req-1', ...data })),
      save: jest.fn(async (data) => data),
      find: jest.fn().mockResolvedValue([]),
    };
    storeRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => ({ id: 'store-1', ...data })),
      save: jest.fn(async (data) => data),
    };
    storeMemberRepository = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
    };
    userRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'vendor-1',
        emailVerified: true,
        isActive: true,
      }),
    };
    notificationsService = {
      notifyAdminAboutNewRequest: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      notifyVendorAboutRequestStatus: jest.fn().mockResolvedValue({ id: 'notif-2' }),
    };
    storageService = {
      assertFolderImageUrl: jest.fn(),
    };

    service = new StoreRequestService(
      storeRequestRepository as never,
      storeRepository as never,
      storeMemberRepository as never,
      userRepository as never,
      notificationsService as never,
      storageService as never,
    );
  });

  it('submits a store request', async () => {
    const result = await service.submit('vendor-1', {
      storeName: 'New Shop',
      description: 'A shop',
    });

    expect(result.storeName).toBe('New Shop');
    expect(storeRequestRepository.save).toHaveBeenCalled();
  });

  it('rejects store request when vendor email is not verified', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'vendor-1',
      emailVerified: false,
      isActive: true,
    });

    await expect(service.submit('vendor-1', { storeName: 'New Shop' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(storeRequestRepository.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate pending requests', async () => {
    storeRequestRepository.findOne.mockResolvedValue({
      id: 'pending-1',
      status: StoreRequestStatus.PENDING,
    });

    await expect(service.submit('vendor-1', { storeName: 'Another Shop' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('approves a pending request and creates store', async () => {
    storeRequestRepository.findOne.mockResolvedValue({
      id: 'req-1',
      vendorUserId: 'vendor-1',
      storeName: 'Approved Shop',
      description: null,
      contactPhone: null,
      contactEmail: null,
      address: { city: 'Bangkok' },
      logoUrl: null,
      status: StoreRequestStatus.PENDING,
    });

    const result = await service.approve('req-1', 'admin-1');

    expect(result.status).toBe(StoreRequestStatus.APPROVED);
    expect(storeRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Approved Shop',
        status: StoreStatus.APPROVED,
      }),
    );
    expect(storeMemberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ role: StoreMemberRole.OWNER }),
    );
  });

  it('sends exactly one vendor notification when approving', async () => {
    storeRequestRepository.findOne.mockResolvedValue({
      id: 'req-1',
      vendorUserId: 'vendor-1',
      storeName: 'Approved Shop',
      description: null,
      contactPhone: null,
      contactEmail: null,
      address: null,
      logoUrl: null,
      status: StoreRequestStatus.PENDING,
    });

    await service.approve('req-1', 'admin-1');

    expect(notificationsService.notifyVendorAboutRequestStatus).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyVendorAboutRequestStatus).toHaveBeenCalledWith(
      'vendor-1',
      'store_request',
      'คำขอเปิดร้าน "Approved Shop" ของคุณได้รับการอนุมัติแล้ว',
      true,
      { requestId: 'req-1', storeId: 'store-1' },
    );
  });

  it('sends exactly one vendor notification when rejecting', async () => {
    storeRequestRepository.findOne.mockResolvedValue({
      id: 'req-1',
      vendorUserId: 'vendor-1',
      storeName: 'Rejected Shop',
      status: StoreRequestStatus.PENDING,
    });

    await service.reject('req-1', 'admin-1', 'ไม่ผ่านเกณฑ์');

    expect(notificationsService.notifyVendorAboutRequestStatus).toHaveBeenCalledTimes(1);
    expect(notificationsService.notifyVendorAboutRequestStatus).toHaveBeenCalledWith(
      'vendor-1',
      'store_request',
      'คำขอเปิดร้าน "Rejected Shop" ของคุณถูกปฏิเสธ',
      false,
      { requestId: 'req-1', reason: 'ไม่ผ่านเกณฑ์' },
    );
  });
});
