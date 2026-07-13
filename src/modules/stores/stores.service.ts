import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Store, StoreStatus, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { StoreMember, StoreMemberRole } from '../../database/entities/store-member.entity';
import { CreateStoreDto, UpdateStoreDto, ApproveStoreDto, RejectStoreDto } from './dto';
import * as bcrypt from 'bcrypt';
import { generateUniqueStoreSlug } from '../../common/utils/slug.util';
import { OmiseService } from '../omise/omise.service';
import { pickDefaultAccessibleStoreId } from './store-selection.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private storeRepository: Repository<Store>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(StoreMember)
    private storeMemberRepository: Repository<StoreMember>,
    private readonly omiseService: OmiseService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
  ) {}

  private async resolveUniqueStoreSlug(name: string): Promise<string> {
    return generateUniqueStoreSlug(name, async (slug) => {
      const existing = await this.storeRepository.findOne({ where: { slug } });
      return !!existing;
    });
  }

  // Register new store (vendor registration)
  async create(createStoreDto: CreateStoreDto): Promise<Store> {
    const { ownerEmail, ownerPassword, ownerFullName, name, ...storeData } = createStoreDto;

    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: ownerEmail },
    });

    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already registered',
      });
    }

    // Create user account
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    const user = this.userRepository.create({
      email: ownerEmail,
      passwordHash,
      fullName: ownerFullName,
      role: UserRole.VENDOR,
    });
    await this.userRepository.save(user);

    const slug = await this.resolveUniqueStoreSlug(name);

    // Create store
    const store = this.storeRepository.create({
      ...storeData,
      name,
      slug,
      ownerId: user.id,
      status: StoreStatus.PENDING,
    });

    return this.storeRepository.save(store);
  }

  // Get all stores (public)
  async findAll(status?: StoreStatus): Promise<Store[]> {
    const where = status ? { status } : { status: StoreStatus.APPROVED };
    return this.storeRepository.find({
      where,
      relations: ['owner', 'products'],
      order: { createdAt: 'DESC' },
    });
  }

  // Get store by ID
  async findOne(id: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { id },
      relations: ['owner', 'products', 'members'],
    });

    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }

    return store;
  }

  // Get store by slug
  async findBySlug(slug: string): Promise<Store> {
    const store = await this.storeRepository.findOne({
      where: { slug },
      relations: ['owner', 'products'],
    });

    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }

    return store;
  }

  // Update store
  async update(id: string, updateStoreDto: UpdateStoreDto): Promise<Store> {
    const store = await this.findOne(id);
    Object.assign(store, updateStoreDto);
    return this.storeRepository.save(store);
  }

  // Approve store (admin)
  async approve(id: string, approveStoreDto: ApproveStoreDto): Promise<Store> {
    const store = await this.findOne(id);

    if (store.status !== StoreStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending stores can be approved',
      });
    }

    store.status = StoreStatus.APPROVED;
    store.approvedBy = approveStoreDto.adminId;
    store.approvedAt = new Date();

    await this.storeRepository.save(store);
    // Notify the vendor that their store was approved
    await this.notificationsService
      .notifyVendorAboutStoreStatus(store.ownerId, store, 'approved')
      .catch(() => {});

    return store;
  }

  // Reject store (admin)
  async reject(id: string, rejectStoreDto: RejectStoreDto): Promise<Store> {
    const store = await this.findOne(id);

    if (store.status !== StoreStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only pending stores can be rejected',
      });
    }

    store.status = StoreStatus.REJECTED;
    store.rejectionReason = rejectStoreDto.rejectionReason ?? null;

    await this.storeRepository.save(store);
    // Notify the vendor that their store was rejected
    await this.notificationsService
      .notifyVendorAboutStoreStatus(
        store.ownerId,
        store,
        'rejected',
        rejectStoreDto.rejectionReason,
      )
      .catch(() => {});

    return store;
  }

  // Suspend store (admin). adminId is kept for a future audit log entry.
  async suspend(id: string, adminId: string): Promise<Store> {
    void adminId;
    const store = await this.findOne(id);

    store.status = StoreStatus.SUSPENDED;

    return this.storeRepository.save(store);
  }

  // Reactivate a suspended store (admin)
  async reactivate(id: string, adminId: string): Promise<Store> {
    const store = await this.findOne(id);

    if (store.status !== StoreStatus.SUSPENDED) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: 'Only suspended stores can be reactivated',
      });
    }

    store.status = StoreStatus.APPROVED;
    store.approvedBy = adminId;
    store.approvedAt = new Date();

    return this.storeRepository.save(store);
  }

  // Get pending stores (admin)
  async getPendingStores(): Promise<Store[]> {
    return this.storeRepository.find({
      where: { status: StoreStatus.PENDING },
      relations: ['owner'],
      order: { createdAt: 'ASC' },
    });
  }

  // Get vendor's stores
  async getVendorStores(userId: string): Promise<Store[]> {
    return this.storeRepository.find({
      where: { ownerId: userId },
      relations: ['products'],
      order: { createdAt: 'DESC' },
    });
  }

  async getAccessibleStores(
    userId: string,
  ): Promise<Array<{ store: Store; membershipRole: string }>> {
    const ownedStores = await this.storeRepository.find({
      where: { ownerId: userId },
      order: { createdAt: 'DESC' },
    });

    const memberships = await this.storeMemberRepository.find({
      where: { userId },
      relations: ['store'],
      order: { createdAt: 'ASC' },
    });

    const byStoreId = new Map<string, { store: Store; membershipRole: string }>();

    for (const store of ownedStores) {
      byStoreId.set(store.id, { store, membershipRole: 'owner' });
    }

    for (const membership of memberships) {
      if (!membership.store || byStoreId.has(membership.storeId)) {
        continue;
      }
      byStoreId.set(membership.storeId, {
        store: membership.store,
        membershipRole: membership.role,
      });
    }

    return Array.from(byStoreId.values());
  }

  async userHasStoreAccess(userId: string, storeId: string): Promise<boolean> {
    const owned = await this.storeRepository.findOne({
      where: { id: storeId, ownerId: userId },
    });
    if (owned) {
      return true;
    }

    const membership = await this.storeMemberRepository.findOne({
      where: { storeId, userId },
    });
    return !!membership;
  }

  async resolveDefaultStoreId(userId: string): Promise<string | undefined> {
    const accessible = await this.getAccessibleStores(userId);
    return pickDefaultAccessibleStoreId(accessible.map((entry) => entry.store));
  }

  async isStoreOwner(userId: string, storeId: string): Promise<boolean> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }
    return store.ownerId === userId;
  }

  async assertStoreOwner(userId: string, storeId: string): Promise<void> {
    const isOwner = await this.isStoreOwner(userId, storeId);
    if (!isOwner) {
      throw new ForbiddenException({
        code: 'STORE_OWNER_REQUIRED',
        message: 'Only the store owner can perform this action',
      });
    }
  }

  async userHasStoreManagerAccess(userId: string, storeId: string): Promise<boolean> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      return false;
    }
    if (store.ownerId === userId) {
      return true;
    }

    const membership = await this.storeMemberRepository.findOne({
      where: { storeId, userId },
    });
    return membership?.role === StoreMemberRole.MANAGER;
  }

  async assertStoreManager(userId: string, storeId: string): Promise<void> {
    const hasAccess = await this.userHasStoreManagerAccess(userId, storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'STORE_MANAGER_REQUIRED',
        message: 'Only store owner or manager can perform this action',
      });
    }
  }

  async updateStoreSettings(
    storeId: string,
    data: Pick<
      UpdateStoreDto,
      'name' | 'description' | 'contactPhone' | 'contactEmail' | 'address' | 'logoUrl' | 'bannerUrl'
    >,
  ): Promise<Store> {
    const store = await this.findOne(storeId);
    if (data.name !== undefined) store.name = data.name;
    if (data.description !== undefined) store.description = data.description;
    if (data.contactPhone !== undefined) store.contactPhone = data.contactPhone;
    if (data.contactEmail !== undefined) store.contactEmail = data.contactEmail;
    if (data.address !== undefined) store.address = data.address;
    if (data.logoUrl !== undefined) {
      const trimmedLogo = data.logoUrl?.trim() || null;
      if (trimmedLogo) {
        this.storageService.assertFolderImageUrl(trimmedLogo, 'stores');
      }
      store.logoUrl = trimmedLogo;
    }
    if (data.bannerUrl !== undefined) {
      const trimmedBanner = data.bannerUrl?.trim() || null;
      if (trimmedBanner) {
        this.storageService.assertFolderImageUrl(trimmedBanner, 'stores');
      }
      store.bannerUrl = trimmedBanner;
    }
    return this.storeRepository.save(store);
  }

  async updateStorePayout(
    storeId: string,
    data: Pick<UpdateStoreDto, 'bankAccountName' | 'bankAccountNumber' | 'bankName' | 'bankCode'>,
  ): Promise<Store> {
    const store = await this.findOne(storeId);

    const bankDetailsChanged =
      (data.bankAccountName !== undefined && data.bankAccountName !== store.bankAccountName) ||
      (data.bankAccountNumber !== undefined &&
        data.bankAccountNumber !== store.bankAccountNumber) ||
      (data.bankCode !== undefined && data.bankCode !== store.bankCode);

    if (data.bankAccountName !== undefined) {
      store.bankAccountName = data.bankAccountName;
    }
    if (data.bankAccountNumber !== undefined) {
      store.bankAccountNumber = data.bankAccountNumber;
    }
    if (data.bankName !== undefined) store.bankName = data.bankName;
    if (data.bankCode !== undefined) store.bankCode = data.bankCode;

    // Persist the bank details first so vendor input is never lost, even if the
    // downstream Omise recipient binding fails.
    await this.storeRepository.save(store);

    if (bankDetailsChanged) {
      await this.syncOmiseRecipient(store);
    }

    return this.storeRepository.save(store);
  }

  /**
   * Binds the store's payout bank account to a real Omise recipient. Creates a
   * new recipient (or updates the existing one) via the Omise API and persists
   * the returned recipient id + verification status on the store. Mutates the
   * given `store` in place; the caller is responsible for saving.
   */
  private async syncOmiseRecipient(store: Store): Promise<void> {
    const hasCompleteBankDetails =
      !!store.bankCode && !!store.bankAccountNumber && !!store.bankAccountName;

    if (!hasCompleteBankDetails) {
      store.omiseRecipientStatus = OmiseRecipientStatus.NOT_CONNECTED;
      store.omiseRecipientFailureMessage = null;
      return;
    }

    if (!this.omiseService.hasCredentials()) {
      store.omiseRecipientStatus = OmiseRecipientStatus.NOT_CONNECTED;
      store.omiseRecipientFailureMessage =
        'Omise API keys are not configured on the server. The receiving account cannot be linked to Omise until OMISE_SECRET_KEY is set.';
      return;
    }

    const params = {
      name: store.bankAccountName as string,
      email: store.contactEmail ?? undefined,
      bankBrand: store.bankCode as string,
      bankNumber: store.bankAccountNumber as string,
      bankName: store.bankAccountName as string,
    };

    try {
      const recipient = store.omiseRecipientId
        ? await this.omiseService.updateRecipient(store.omiseRecipientId, params)
        : await this.omiseService.createRecipient(params);

      store.omiseRecipientId = recipient.id;
      store.omiseRecipientFailureMessage = null;
      store.omiseRecipientStatus =
        recipient.verified && recipient.active
          ? OmiseRecipientStatus.ACTIVE
          : OmiseRecipientStatus.PENDING;
    } catch (error) {
      const message =
        error instanceof BadRequestException
          ? ((error.getResponse() as { message?: string })?.message ??
            'Failed to link the receiving account to Omise')
          : 'Failed to link the receiving account to Omise';
      store.omiseRecipientStatus = OmiseRecipientStatus.FAILED;
      store.omiseRecipientFailureMessage = message;
    }
  }

  async findAllForAdmin(): Promise<Store[]> {
    return this.storeRepository.find({
      relations: ['owner'],
      order: { createdAt: 'DESC' },
    });
  }

  async createAsAdmin(input: {
    ownerUserId: string;
    name: string;
    description?: string;
    contactPhone?: string;
    contactEmail?: string;
    address?: string;
    logoUrl?: string;
    bannerUrl?: string;
    status?: StoreStatus;
  }): Promise<Store> {
    if (!input.ownerUserId?.trim()) {
      throw new BadRequestException({
        code: 'OWNER_REQUIRED',
        message: 'Store owner is required',
      });
    }

    const owner = await this.userRepository.findOne({
      where: { id: input.ownerUserId, role: UserRole.VENDOR },
    });
    if (!owner) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor user not found',
      });
    }

    const slug = await this.resolveUniqueStoreSlug(input.name);

    const store = this.storeRepository.create({
      name: input.name,
      slug,
      description: input.description ?? null,
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      address: input.address ?? null,
      logoUrl: input.logoUrl ?? null,
      bannerUrl: input.bannerUrl ?? null,
      ownerId: input.ownerUserId,
      status: input.status ?? StoreStatus.APPROVED,
      approvedAt: input.status === StoreStatus.APPROVED ? new Date() : null,
    });
    const saved = await this.storeRepository.save(store);

    const member = this.storeMemberRepository.create({
      storeId: saved.id,
      userId: input.ownerUserId,
      role: StoreMemberRole.OWNER,
    });
    await this.storeMemberRepository.save(member);
    return this.findOne(saved.id);
  }

  async updateAsAdmin(input: {
    id: string;
    ownerUserId?: string | null;
    name?: string;
    slug?: string;
    description?: string;
    contactPhone?: string;
    contactEmail?: string;
    address?: string;
    logoUrl?: string;
    bannerUrl?: string;
    status?: StoreStatus;
  }): Promise<Store> {
    const store = await this.findOne(input.id);

    if (input.ownerUserId !== undefined) {
      if (input.ownerUserId === null) {
        throw new BadRequestException({
          code: 'OWNER_REQUIRED',
          message: 'Store owner is required',
        });
      }

      if (input.ownerUserId !== store.ownerId) {
        const owner = await this.userRepository.findOne({
          where: { id: input.ownerUserId, role: UserRole.VENDOR },
        });
        if (!owner) {
          throw new NotFoundException({
            code: 'VENDOR_NOT_FOUND',
            message: 'Vendor user not found',
          });
        }

        const previousOwnerId = store.ownerId;
        store.ownerId = owner.id;
        store.owner = owner;
        await this.syncStoreOwnerMembership(store.id, previousOwnerId, owner.id);
      }
    }

    if (input.name !== undefined) store.name = input.name;
    if (input.slug !== undefined) store.slug = input.slug;
    if (input.description !== undefined) store.description = input.description;
    if (input.contactPhone !== undefined) store.contactPhone = input.contactPhone;
    if (input.contactEmail !== undefined) store.contactEmail = input.contactEmail;
    if (input.address !== undefined) store.address = input.address;
    if (input.logoUrl !== undefined) store.logoUrl = input.logoUrl;
    if (input.bannerUrl !== undefined) store.bannerUrl = input.bannerUrl;
    if (input.status !== undefined) store.status = input.status;

    await this.storeRepository.save(store);
    return this.findOne(input.id);
  }

  private async syncStoreOwnerMembership(
    storeId: string,
    previousOwnerId: string,
    newOwnerId: string,
  ): Promise<void> {
    const existingNewMember = await this.storeMemberRepository.findOne({
      where: { storeId, userId: newOwnerId },
    });
    if (existingNewMember) {
      existingNewMember.role = StoreMemberRole.OWNER;
      await this.storeMemberRepository.save(existingNewMember);
    } else {
      await this.storeMemberRepository.save(
        this.storeMemberRepository.create({
          storeId,
          userId: newOwnerId,
          role: StoreMemberRole.OWNER,
        }),
      );
    }

    if (previousOwnerId === newOwnerId) {
      return;
    }

    const previousMember = await this.storeMemberRepository.findOne({
      where: { storeId, userId: previousOwnerId },
    });
    if (previousMember?.role === StoreMemberRole.OWNER) {
      previousMember.role = StoreMemberRole.STAFF;
      await this.storeMemberRepository.save(previousMember);
    }
  }

  async findVendors(search?: string): Promise<User[]> {
    const trimmed = search?.trim();
    if (!trimmed) {
      return this.userRepository.find({
        where: { role: UserRole.VENDOR },
        relations: ['ownedStores'],
        order: { createdAt: 'DESC' },
      });
    }

    return this.userRepository.find({
      where: [
        { role: UserRole.VENDOR, fullName: ILike(`%${trimmed}%`) },
        { role: UserRole.VENDOR, email: ILike(`%${trimmed}%`) },
      ],
      relations: ['ownedStores'],
      order: { createdAt: 'DESC' },
    });
  }

  async findVendorById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, role: UserRole.VENDOR },
      relations: ['ownedStores'],
    });
    if (!user) {
      throw new NotFoundException({
        code: 'VENDOR_NOT_FOUND',
        message: 'Vendor not found',
      });
    }
    return user;
  }

  async updateVendorAsAdmin(input: {
    id: string;
    email?: string;
    fullName?: string;
    isActive?: boolean;
  }): Promise<User> {
    const user = await this.findVendorById(input.id);
    if (input.email !== undefined) {
      const existing = await this.userRepository.findOne({
        where: { email: input.email },
      });
      if (existing && existing.id !== input.id) {
        throw new ConflictException({
          code: 'EMAIL_EXISTS',
          message: 'Email already in use',
        });
      }
      user.email = input.email;
    }
    if (input.fullName !== undefined) user.fullName = input.fullName;
    if (input.isActive !== undefined) user.isActive = input.isActive;
    return this.userRepository.save(user);
  }

  async registerVendor(input: {
    email: string;
    password: string;
    fullName: string;
  }): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { email: input.email },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = this.userRepository.create({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: UserRole.VENDOR,
    });
    return this.userRepository.save(user);
  }
}
