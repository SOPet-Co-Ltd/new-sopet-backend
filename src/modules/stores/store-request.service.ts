import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreRequest, StoreRequestStatus } from '../../database/entities/store-request.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { StoreMember, StoreMemberRole } from '../../database/entities/store-member.entity';
import { User } from '../../database/entities/user.entity';
import { generateUniqueStoreSlug } from '../../common/utils/slug.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

export interface SubmitStoreRequestData {
  storeName: string;
  description?: string;
  contactPhone?: string;
  contactEmail?: string;
  address?: string;
  logoUrl?: string;
}

@Injectable()
export class StoreRequestService {
  constructor(
    @InjectRepository(StoreRequest)
    private readonly storeRequestRepository: Repository<StoreRequest>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreMember)
    private readonly storeMemberRepository: Repository<StoreMember>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
  ) {}

  async submit(vendorUserId: string, data: SubmitStoreRequestData): Promise<StoreRequest> {
    const vendor = await this.userRepository.findOne({
      where: { id: vendorUserId, isActive: true },
    });

    if (!vendor) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }

    if (!vendor.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'กรุณายืนยันอีเมลก่อนขอเปิดร้านใหม่',
      });
    }

    const pending = await this.storeRequestRepository.findOne({
      where: {
        vendorUserId,
        status: StoreRequestStatus.PENDING,
      },
    });

    if (pending) {
      throw new ConflictException({
        code: 'PENDING_REQUEST_EXISTS',
        message: 'You already have a pending store request',
      });
    }

    const trimmedLogo = data.logoUrl?.trim() || null;
    if (trimmedLogo) {
      this.storageService.assertFolderImageUrl(trimmedLogo, 'stores');
    }

    const request = this.storeRequestRepository.create({
      vendorUserId,
      storeName: data.storeName,
      description: data.description ?? null,
      contactPhone: data.contactPhone ?? null,
      contactEmail: data.contactEmail ?? null,
      address: data.address ?? null,
      logoUrl: trimmedLogo,
      status: StoreRequestStatus.PENDING,
    });

    const saved = await this.storeRequestRepository.save(request);

    // Notify admins about the new request
    this.notificationsService.notifyAdminAboutNewRequest(saved).catch(() => {});

    return saved;
  }

  async findByVendor(vendorUserId: string): Promise<StoreRequest[]> {
    return this.storeRequestRepository.find({
      where: { vendorUserId },
      order: { createdAt: 'DESC' },
    });
  }

  async findPending(): Promise<StoreRequest[]> {
    return this.storeRequestRepository.find({
      where: { status: StoreRequestStatus.PENDING },
      relations: ['vendorUser'],
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(id: string): Promise<StoreRequest> {
    const request = await this.storeRequestRepository.findOne({
      where: { id },
      relations: ['vendorUser'],
    });
    if (!request) {
      throw new NotFoundException({
        code: 'STORE_REQUEST_NOT_FOUND',
        message: 'Store request not found',
      });
    }
    return request;
  }

  async approve(id: string, adminId: string): Promise<StoreRequest> {
    const request = await this.findOne(id);

    if (request.status !== StoreRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending requests can be approved',
      });
    }

    const slug = await generateUniqueStoreSlug(request.storeName, async (candidate) => {
      const existing = await this.storeRepository.findOne({ where: { slug: candidate } });
      return !!existing;
    });

    const store = this.storeRepository.create({
      ownerId: request.vendorUserId,
      name: request.storeName,
      slug,
      description: request.description,
      contactPhone: request.contactPhone,
      contactEmail: request.contactEmail,
      address: request.address,
      logoUrl: request.logoUrl,
      status: StoreStatus.APPROVED,
      approvedBy: adminId,
      approvedAt: new Date(),
    });
    const savedStore = await this.storeRepository.save(store);

    const member = this.storeMemberRepository.create({
      storeId: savedStore.id,
      userId: request.vendorUserId,
      role: StoreMemberRole.OWNER,
    });
    await this.storeMemberRepository.save(member);

    request.status = StoreRequestStatus.APPROVED;
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();
    request.createdStoreId = savedStore.id;

    const saved = await this.storeRequestRepository.save(request);

    await this.notificationsService.notifyVendorAboutRequestStatus(
      request.vendorUserId,
      'store_request',
      `คำขอเปิดร้าน "${request.storeName}" ของคุณได้รับการอนุมัติแล้ว`,
      true,
      { requestId: request.id, storeId: savedStore.id },
    );

    return saved;
  }

  async reject(id: string, adminId: string, reason?: string): Promise<StoreRequest> {
    const request = await this.findOne(id);

    if (request.status !== StoreRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending requests can be rejected',
      });
    }

    request.status = StoreRequestStatus.REJECTED;
    request.rejectionReason = reason ?? null;
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();

    const saved = await this.storeRequestRepository.save(request);

    await this.notificationsService.notifyVendorAboutRequestStatus(
      request.vendorUserId,
      'store_request',
      `คำขอเปิดร้าน "${request.storeName}" ของคุณถูกปฏิเสธ`,
      false,
      { requestId: request.id, reason: reason ?? null },
    );

    return saved;
  }
}
