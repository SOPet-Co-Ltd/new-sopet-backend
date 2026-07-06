import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Store, StoreStatus } from '../entities/store.entity';

@Injectable()
export class StoreRepository {
  constructor(
    @InjectRepository(Store)
    private readonly repository: Repository<Store>,
  ) {}

  async findBySlug(slug: string): Promise<Store | null> {
    return this.repository.findOne({
      where: { slug, deletedAt: IsNull() },
      relations: ['owner'],
    });
  }

  async findById(id: string): Promise<Store | null> {
    return this.repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['owner'],
    });
  }

  async findByOwnerId(ownerId: string): Promise<Store[]> {
    return this.repository.find({
      where: { ownerId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingApproval(): Promise<Store[]> {
    return this.repository.find({
      where: { status: StoreStatus.PENDING, deletedAt: IsNull() },
      relations: ['owner'],
      order: { createdAt: 'ASC' },
    });
  }

  async findApproved(limit: number = 20, offset: number = 0): Promise<Store[]> {
    return this.repository.find({
      where: { status: StoreStatus.APPROVED, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async create(data: {
    ownerId: string;
    name: string;
    slug: string;
    description?: string;
    logoUrl?: string;
    contactPhone?: string;
    contactEmail?: string;
    address?: string;
  }): Promise<Store> {
    const store = this.repository.create({
      ...data,
      status: StoreStatus.PENDING,
    });

    return this.repository.save(store);
  }

  async approve(id: string, adminId: string): Promise<Store | null> {
    await this.repository.update(id, {
      status: StoreStatus.APPROVED,
      approvedBy: adminId,
      approvedAt: new Date(),
      rejectionReason: null,
    });

    return this.findById(id);
  }

  async reject(id: string, adminId: string, reason: string): Promise<Store | null> {
    await this.repository.update(id, {
      status: StoreStatus.REJECTED,
      approvedBy: adminId,
      approvedAt: new Date(),
      rejectionReason: reason,
    });

    return this.findById(id);
  }

  async suspend(id: string): Promise<void> {
    await this.repository.update(id, {
      status: StoreStatus.SUSPENDED,
    });
  }

  async unsuspend(id: string): Promise<void> {
    await this.repository.update(id, {
      status: StoreStatus.APPROVED,
    });
  }

  async updateBankInfo(
    id: string,
    data: {
      bankAccountName: string;
      bankAccountNumber: string;
      bankName: string;
    },
  ): Promise<void> {
    await this.repository.update(id, data);
  }

  async updateProfile(
    id: string,
    data: Partial<
      Pick<
        Store,
        | 'name'
        | 'description'
        | 'logoUrl'
        | 'bannerUrl'
        | 'contactPhone'
        | 'contactEmail'
        | 'address'
      >
    >,
  ): Promise<void> {
    await this.repository.update(id, data);
  }

  async softDelete(id: string): Promise<void> {
    await this.repository.softDelete(id);
  }
}
