import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  StoreReactivationRequest,
  StoreReactivationRequestStatus,
} from '../../database/entities/store-reactivation-request.entity';
import { StoreReactivationRequestImage } from '../../database/entities/store-reactivation-request-image.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { StoresService } from './stores.service';

export interface SubmitStoreReactivationRequestData {
  storeId: string;
  title: string;
  content: string;
  mediaUrls?: string[];
}

@Injectable()
export class StoreReactivationRequestService {
  constructor(
    @InjectRepository(StoreReactivationRequest)
    private readonly requestRepository: Repository<StoreReactivationRequest>,
    @InjectRepository(StoreReactivationRequestImage)
    private readonly imageRepository: Repository<StoreReactivationRequestImage>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly storesService: StoresService,
  ) {}

  async submit(
    userId: string,
    data: SubmitStoreReactivationRequestData,
  ): Promise<StoreReactivationRequest> {
    const store = await this.storeRepository.findOne({
      where: { id: data.storeId },
    });
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }

    if (store.status !== StoreStatus.SUSPENDED) {
      throw new BadRequestException({
        code: 'STORE_NOT_SUSPENDED',
        message: 'Reactivation requests can only be submitted for suspended stores',
      });
    }

    const canManage = await this.storesService.userHasStoreManagerAccess(userId, data.storeId);
    if (!canManage) {
      throw new ForbiddenException({
        code: 'STORE_MANAGER_REQUIRED',
        message: 'Only store owner or manager can submit reactivation requests',
      });
    }

    const pending = await this.requestRepository.findOne({
      where: {
        storeId: data.storeId,
        status: StoreReactivationRequestStatus.PENDING,
      },
    });
    if (pending) {
      throw new ConflictException({
        code: 'PENDING_REACTIVATION_REQUEST_EXISTS',
        message: 'This store already has a pending reactivation request',
      });
    }

    const request = this.requestRepository.create({
      storeId: data.storeId,
      submittedByUserId: userId,
      title: data.title,
      content: data.content,
      status: StoreReactivationRequestStatus.PENDING,
    });
    const saved = await this.requestRepository.save(request);

    const mediaUrls = data.mediaUrls ?? [];
    if (mediaUrls.length > 0) {
      const images = mediaUrls.map((imageUrl, index) =>
        this.imageRepository.create({
          requestId: saved.id,
          imageUrl,
          sortOrder: index,
        }),
      );
      await this.imageRepository.save(images);
    }

    return this.findOne(saved.id);
  }

  async findByStore(storeId: string): Promise<StoreReactivationRequest[]> {
    return this.requestRepository.find({
      where: { storeId },
      relations: ['images', 'store', 'submittedBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async findForAdmin(status?: StoreReactivationRequestStatus): Promise<StoreReactivationRequest[]> {
    const where = status ? { status } : {};
    return this.requestRepository.find({
      where,
      relations: ['images', 'store', 'submittedBy', 'store.owner'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<StoreReactivationRequest> {
    const request = await this.requestRepository.findOne({
      where: { id },
      relations: ['images', 'store', 'submittedBy', 'store.owner'],
    });
    if (!request) {
      throw new NotFoundException({
        code: 'REACTIVATION_REQUEST_NOT_FOUND',
        message: 'Reactivation request not found',
      });
    }
    return request;
  }

  async approve(id: string, adminId: string): Promise<StoreReactivationRequest> {
    const request = await this.findOne(id);

    if (request.status !== StoreReactivationRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending requests can be approved',
      });
    }

    await this.storesService.reactivate(request.storeId, adminId);

    request.status = StoreReactivationRequestStatus.APPROVED;
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();

    return this.requestRepository.save(request);
  }

  async reject(
    id: string,
    adminId: string,
    reviewNote?: string,
  ): Promise<StoreReactivationRequest> {
    const request = await this.findOne(id);

    if (request.status !== StoreReactivationRequestStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending requests can be rejected',
      });
    }

    request.status = StoreReactivationRequestStatus.REJECTED;
    request.reviewNote = reviewNote ?? null;
    request.reviewedBy = adminId;
    request.reviewedAt = new Date();

    return this.requestRepository.save(request);
  }
}
