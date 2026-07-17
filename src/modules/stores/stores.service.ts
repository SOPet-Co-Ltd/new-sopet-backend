import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, ILike } from 'typeorm';
import { Store, StoreStatus, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { User, UserRole } from '../../database/entities/user.entity';
import { StoreMember, StoreMemberRole } from '../../database/entities/store-member.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { AuditLog, AuditActorType } from '../../database/entities/audit-log.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { CreateStoreDto, UpdateStoreDto, ApproveStoreDto, RejectStoreDto } from './dto';
import * as bcrypt from 'bcrypt';
import { generateUniqueStoreSlug } from '../../common/utils/slug.util';
import { OmiseService } from '../omise/omise.service';
import { pickDefaultAccessibleStoreId } from './store-selection.util';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';

const VENDOR_REVENUE_EXCLUDED_STATUSES = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.PENDING_PAYMENT,
];

const AUDIT_ACTION_ACTIVITY_KIND: Partial<Record<string, string>> = {
  [AuditAction.LOGIN]: 'last_login',
  [AuditAction.PASSWORD_RESET_SENT]: 'password_reset_sent',
  [AuditAction.VENDOR_UPDATED]: 'vendor_updated',
  [AuditAction.STORE_CREATED]: 'store_created',
  [AuditAction.STORE_APPROVED]: 'admin_store_approved',
  [AuditAction.STORE_REJECTED]: 'admin_store_rejected',
  [AuditAction.STORE_SUSPENDED]: 'admin_store_suspended',
  [AuditAction.STORE_REACTIVATED]: 'store_reactivated',
  [AuditAction.STORE_OWNER_CHANGED]: 'store_owner_changed',
};

export type AdminVendorInsightsResult = {
  storeCount: number;
  membershipCount: number;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  lastOrderAt: Date | null;
  lastActivityAt: Date | null;
  memberships: Array<{
    storeId: string;
    storeName: string;
    storeSlug: string;
    storeStatus: string;
    role: string;
    joinedAt: Date;
  }>;
  activities: Array<{
    kind: string;
    occurredAt: Date;
    storeId?: string | null;
    storeName?: string | null;
    orderNumber?: string | null;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: Date;
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }>;
  }>;
};

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(StoreMember)
    private readonly storeMemberRepository: Repository<StoreMember>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly omiseService: OmiseService,
    private readonly notificationsService: NotificationsService,
    private readonly storageService: StorageService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async logAdminStoreAction(
    adminId: string,
    action: string,
    store: Store,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const admin = await this.userRepository.findOne({
      where: { id: adminId },
      select: ['id', 'fullName', 'email'],
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: admin?.fullName || admin?.email || null,
      action,
      resourceType: AuditResourceType.STORE,
      resourceId: store.id,
      metadata: { storeName: store.name, ...metadata },
    });
  }

  private async resolveUniqueStoreSlug(name: string): Promise<string> {
    return generateUniqueStoreSlug(name, async (slug) => {
      const existing = await this.storeRepository.findOne({ where: { slug } });
      return !!existing;
    });
  }

  async create(createStoreDto: CreateStoreDto): Promise<Store> {
    const { ownerEmail, ownerPassword, ownerFullName, name, ...storeData } = createStoreDto;

    const existingUser = await this.userRepository.findOne({
      where: { email: ownerEmail },
    });

    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email already registered',
      });
    }

    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    const user = this.userRepository.create({
      email: ownerEmail,
      passwordHash,
      fullName: ownerFullName,
      role: UserRole.VENDOR,
    });
    await this.userRepository.save(user);

    const slug = await this.resolveUniqueStoreSlug(name);

    const store = this.storeRepository.create({
      ...storeData,
      name,
      slug,
      ownerId: user.id,
      status: StoreStatus.PENDING,
    });

    return this.storeRepository.save(store);
  }

  async findAll(status?: StoreStatus): Promise<Store[]> {
    const where = status ? { status } : { status: StoreStatus.APPROVED };
    return this.storeRepository.find({
      where,
      relations: ['owner', 'products'],
      order: { createdAt: 'DESC' },
    });
  }

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

    await this.logAdminStoreAction(approveStoreDto.adminId, AuditAction.STORE_APPROVED, store);

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

    await this.logAdminStoreAction(rejectStoreDto.adminId, AuditAction.STORE_REJECTED, store, {
      rejectionReason: rejectStoreDto.rejectionReason ?? null,
    });

    return store;
  }

  // Suspend store (admin)
  async suspend(id: string, adminId: string): Promise<Store> {
    const store = await this.findOne(id);

    store.status = StoreStatus.SUSPENDED;

    const saved = await this.storeRepository.save(store);
    await this.logAdminStoreAction(adminId, AuditAction.STORE_SUSPENDED, saved);
    return saved;
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

    const saved = await this.storeRepository.save(store);
    await this.logAdminStoreAction(adminId, AuditAction.STORE_REACTIVATED, saved);
    return saved;
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
   * Re-fetches the Omise recipient and updates local verification status.
   * Called when vendors open payout settings so Omise dashboard activations
   * are reflected without requiring a bank-detail re-save.
   */
  async refreshOmiseRecipientStatus(storeId: string): Promise<Store> {
    const store = await this.findOne(storeId);
    await this.applyOmiseRecipientSnapshot(store);
    return this.storeRepository.save(store);
  }

  /**
   * Handles Omise recipient.* webhooks by refreshing the matching store's
   * recipient status from the live Omise API.
   */
  async handleOmiseRecipientWebhook(payload: {
    key?: string;
    data?: { object?: string; id?: string; verified?: boolean; active?: boolean };
  }): Promise<void> {
    const recipientId = payload.data?.id;
    if (!recipientId || payload.data?.object !== 'recipient') {
      return;
    }

    const store = await this.storeRepository.findOne({
      where: { omiseRecipientId: recipientId },
    });
    if (!store) {
      return;
    }

    await this.applyOmiseRecipientSnapshot(store, payload.data);
    await this.storeRepository.save(store);
  }

  /**
   * Applies Omise recipient verified/active flags onto the store. Prefers a
   * live API fetch when credentials are available; falls back to webhook
   * payload fields when present.
   */
  private async applyOmiseRecipientSnapshot(
    store: Store,
    fallback?: { verified?: boolean; active?: boolean },
  ): Promise<void> {
    if (!store.omiseRecipientId) {
      return;
    }

    if (this.omiseService.hasCredentials()) {
      try {
        const recipient = await this.omiseService.getRecipient(store.omiseRecipientId);
        this.applyRecipientFlags(store, recipient.verified, recipient.active);
        return;
      } catch {
        // Fall through to webhook payload when API refresh fails.
      }
    }

    if (fallback && fallback.verified !== undefined && fallback.active !== undefined) {
      this.applyRecipientFlags(store, fallback.verified, fallback.active);
    }
  }

  private applyRecipientFlags(store: Store, verified: boolean, active: boolean): void {
    store.omiseRecipientStatus =
      verified && active ? OmiseRecipientStatus.ACTIVE : OmiseRecipientStatus.PENDING;
    if (store.omiseRecipientStatus === OmiseRecipientStatus.ACTIVE) {
      store.omiseRecipientFailureMessage = null;
    }
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

  async getVendorInsightsForAdmin(vendorId: string): Promise<AdminVendorInsightsResult> {
    const vendor = await this.findVendorById(vendorId);
    const ownedStores = vendor.ownedStores ?? [];
    const ownedStoreIds = ownedStores.map((store) => store.id);

    let orderCount = 0;
    let totalRevenue = 0;
    let lastOrderAt: Date | null = null;
    let recentOrders: AdminVendorInsightsResult['recentOrders'] = [];

    if (ownedStoreIds.length > 0) {
      const statsResult = await this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'order')
        .select('COUNT(DISTINCT order.id)', 'orderCount')
        .addSelect('COALESCE(SUM(item.subtotal), 0)', 'totalRevenue')
        .addSelect('MAX(order.createdAt)', 'lastOrderAt')
        .where('item.storeId IN (:...storeIds)', { storeIds: ownedStoreIds })
        .andWhere('order.status NOT IN (:...excludedStatuses)', {
          excludedStatuses: VENDOR_REVENUE_EXCLUDED_STATUSES,
        })
        .getRawOne<{ orderCount: string; totalRevenue: string; lastOrderAt: Date | null }>();

      orderCount = Number(statsResult?.orderCount ?? 0);
      totalRevenue = Number(statsResult?.totalRevenue ?? 0);
      lastOrderAt = statsResult?.lastOrderAt ?? null;

      const recentOrderRows = await this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin('item.order', 'order')
        .select('order.id', 'id')
        .addSelect('MAX(order.createdAt)', 'createdAt')
        .where('item.storeId IN (:...storeIds)', { storeIds: ownedStoreIds })
        .groupBy('order.id')
        .orderBy('MAX(order.createdAt)', 'DESC')
        .limit(10)
        .getRawMany<{ id: string }>();

      const recentOrderIds = recentOrderRows.map((row) => row.id);
      if (recentOrderIds.length > 0) {
        const orders = await this.orderRepository.find({
          where: { id: In(recentOrderIds) },
          relations: ['items'],
          order: { createdAt: 'DESC' },
        });
        recentOrders = orders.map((order) => ({
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: Number(order.total),
          createdAt: order.createdAt,
          items: (order.items ?? []).map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            subtotal: Number(item.subtotal),
          })),
        }));
      }
    }

    const averageOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;

    const storeMembers = await this.storeMemberRepository.find({
      where: { userId: vendorId },
      relations: ['store'],
      order: { createdAt: 'DESC' },
    });

    const memberships = storeMembers
      .filter(
        (member) =>
          member.store &&
          (member.role !== StoreMemberRole.OWNER || member.store.ownerId !== vendorId),
      )
      .map((member) => ({
        storeId: member.storeId,
        storeName: member.store.name,
        storeSlug: member.store.slug,
        storeStatus: member.store.status,
        role: member.role,
        joinedAt: member.createdAt,
      }));

    const storeNameById = new Map(ownedStores.map((store) => [store.id, store.name]));
    const activities: AdminVendorInsightsResult['activities'] = [
      {
        kind: 'account_created',
        occurredAt: vendor.createdAt,
      },
    ];

    if (vendor.lastLoginAt) {
      activities.push({
        kind: 'last_login',
        occurredAt: vendor.lastLoginAt,
      });
    }

    for (const store of ownedStores) {
      activities.push({
        kind: 'store_created',
        occurredAt: store.createdAt,
        storeId: store.id,
        storeName: store.name,
      });
      storeNameById.set(store.id, store.name);
    }

    for (const membership of memberships) {
      activities.push({
        kind: 'membership_joined',
        occurredAt: membership.joinedAt,
        storeId: membership.storeId,
        storeName: membership.storeName,
      });
    }

    const auditLogQuery = this.auditLogRepository
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .take(30);

    if (ownedStoreIds.length > 0) {
      auditLogQuery.where(
        '(log.resourceType = :storeType AND log.resourceId IN (:...storeIds)) OR (log.actorType = :vendorActor AND log.actorId = :vendorId) OR (log.resourceType = :vendorType AND log.resourceId = :vendorId)',
        {
          storeType: AuditResourceType.STORE,
          storeIds: ownedStoreIds,
          vendorActor: AuditActorType.VENDOR,
          vendorId,
          vendorType: AuditResourceType.VENDOR,
        },
      );
    } else {
      auditLogQuery.where(
        '(log.actorType = :vendorActor AND log.actorId = :vendorId) OR (log.resourceType = :vendorType AND log.resourceId = :vendorId)',
        {
          vendorActor: AuditActorType.VENDOR,
          vendorId,
          vendorType: AuditResourceType.VENDOR,
        },
      );
    }

    const auditLogs = await auditLogQuery.getMany();

    for (const log of auditLogs) {
      const kind = AUDIT_ACTION_ACTIVITY_KIND[log.action];
      if (!kind) continue;
      const storeNameFromMeta =
        typeof log.metadata?.storeName === 'string' ? log.metadata.storeName : null;
      activities.push({
        kind,
        occurredAt: log.createdAt,
        storeId: log.resourceType === AuditResourceType.STORE ? log.resourceId : undefined,
        storeName:
          storeNameFromMeta ??
          (log.resourceId ? (storeNameById.get(log.resourceId) ?? null) : null),
      });
    }

    for (const order of recentOrders.slice(0, 5)) {
      activities.push({
        kind: 'order_received',
        occurredAt: order.createdAt,
        orderNumber: order.orderNumber,
      });
    }

    activities.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    const trimmedActivities = activities.slice(0, 20);
    const lastActivityAt =
      trimmedActivities[0]?.occurredAt ?? vendor.lastLoginAt ?? vendor.createdAt;

    return {
      storeCount: ownedStores.length,
      membershipCount: memberships.length,
      totalRevenue,
      orderCount,
      averageOrderValue,
      lastOrderAt,
      lastActivityAt,
      memberships,
      activities: trimmedActivities,
      recentOrders,
    };
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
