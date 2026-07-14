import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, QueryFailedError, Repository, DataSource } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { PetType } from '../../database/entities/pet-type.entity';
import { Brand } from '../../database/entities/brand.entity';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import { UserRole } from '../../database/entities/user.entity';
import { generateSlug } from '../../common/utils/slug.util';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SearchEmbeddingQueueService } from '../search/embedding/search-embedding-queue.service';
import { DeleteTaxonomyResult, TaxonomyDeleteImpact } from './taxonomy-delete.types';

type TaxonomyRepository = Repository<Category | Tag | PetType | Brand>;

@Injectable()
export class TaxonomyService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
    @InjectRepository(PetType)
    private readonly petTypeRepository: Repository<PetType>,
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly searchEmbeddingQueueService?: SearchEmbeddingQueueService,
  ) {}

  private async ensureUniqueSlug(
    repository: TaxonomyRepository,
    name: string,
    fallback: string,
  ): Promise<string> {
    let slug = generateSlug(name, fallback);
    let exists = await repository.findOne({ where: { slug } });
    let counter = 1;

    while (exists) {
      slug = `${generateSlug(name, fallback)}-${counter}`;
      exists = await repository.findOne({ where: { slug } });
      counter++;
    }

    return slug;
  }

  private async assertUniqueName(
    repository: TaxonomyRepository,
    name: string,
    label: string,
  ): Promise<void> {
    const existing = await repository.findOne({
      where: {
        name: ILike(name.trim()),
        approvalStatus: Not(TaxonomyApprovalStatus.REJECTED),
      },
    });

    if (existing) {
      throw this.duplicateNameError(label);
    }
  }

  private duplicateNameError(label: string): ConflictException {
    return new ConflictException({
      code: 'DUPLICATE_NAME',
      message: `มี${label}ชื่อนี้อยู่แล้ว`,
    });
  }

  private slugExistsError(): ConflictException {
    return new ConflictException({
      code: 'SLUG_EXISTS',
      message: 'ชื่อย่อ (slug) นี้ถูกใช้งานแล้ว',
    });
  }

  private invalidSlugError(): BadRequestException {
    return new BadRequestException({
      code: 'INVALID_SLUG',
      message: 'รูปแบบ slug ไม่ถูกต้อง',
    });
  }

  /**
   * Normalize an admin-provided slug. Empty / unusable input is rejected.
   */
  private normalizeProvidedSlug(slug: string): string {
    const normalized = generateSlug(slug.trim(), '');
    if (!normalized) {
      throw this.invalidSlugError();
    }
    return normalized;
  }

  private async assertUniqueSlug(
    repository: TaxonomyRepository,
    slug: string,
    excludeId: string,
  ): Promise<void> {
    const existing = await repository.findOne({ where: { slug } });
    if (existing && existing.id !== excludeId) {
      throw this.slugExistsError();
    }
  }

  /**
   * Backstop for the partial unique index (`idx_*_name_lower`): when a
   * concurrent request slips past `assertUniqueName`, Postgres raises a unique
   * violation (23505). Translate it into the same clean Thai CONFLICT error
   * instead of leaking a raw 500.
   */
  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
  }

  async findCategoriesByCreator(createdBy: string): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { createdBy },
      order: { createdAt: 'DESC' },
    });
  }

  async findTagsByCreator(createdBy: string): Promise<Tag[]> {
    return this.tagRepository.find({
      where: { createdBy },
      order: { createdAt: 'DESC' },
    });
  }

  private resolveApprovalStatus(role: UserRole): TaxonomyApprovalStatus {
    return role === UserRole.ADMIN
      ? TaxonomyApprovalStatus.APPROVED
      : TaxonomyApprovalStatus.PENDING;
  }

  async findApprovedCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.APPROVED },
      order: { name: 'ASC' },
    });
  }

  async findApprovedTags(): Promise<Tag[]> {
    return this.tagRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.APPROVED },
      order: { name: 'ASC' },
    });
  }

  async findPendingCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingTags(): Promise<Tag[]> {
    return this.tagRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async findRejectedCategories(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
      order: { name: 'ASC' },
    });
  }

  async findRejectedTags(): Promise<Tag[]> {
    return this.tagRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
      order: { createdAt: 'DESC' },
    });
  }

  async findRejectedPetTypes(): Promise<PetType[]> {
    return this.petTypeRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
      order: { createdAt: 'DESC' },
    });
  }

  async findRejectedBrands(): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
      order: { createdAt: 'DESC' },
    });
  }

  async createCategory(
    name: string,
    createdBy: string,
    role: UserRole,
    imageUrl?: string | null,
  ): Promise<Category> {
    await this.assertUniqueName(this.categoryRepository, name, 'หมวดหมู่');

    const slug = await this.ensureUniqueSlug(this.categoryRepository, name, 'category');

    const trimmedImageUrl = imageUrl?.trim() || null;
    if (trimmedImageUrl) {
      this.storageService.assertFolderImageUrl(trimmedImageUrl, 'categories');
    }

    const category = this.categoryRepository.create({
      name: name.trim(),
      slug,
      createdBy,
      approvalStatus: this.resolveApprovalStatus(role),
      imageUrl: trimmedImageUrl,
    });

    try {
      return await this.categoryRepository.save(category);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('หมวดหมู่');
      }
      throw error;
    }
  }

  async createTag(name: string, createdBy: string, role: UserRole): Promise<Tag> {
    await this.assertUniqueName(this.tagRepository, name, 'แท็ก');

    const slug = await this.ensureUniqueSlug(this.tagRepository, name, 'tag');

    const tag = this.tagRepository.create({
      name: name.trim(),
      slug,
      createdBy,
      approvalStatus: this.resolveApprovalStatus(role),
    });

    try {
      return await this.tagRepository.save(tag);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('แท็ก');
      }
      throw error;
    }
  }

  async updateTag(tagId: string, name: string, slug?: string | null): Promise<Tag> {
    const tag = await this.tagRepository.findOne({ where: { id: tagId } });

    if (!tag) {
      throw new NotFoundException({
        code: 'TAG_NOT_FOUND',
        message: 'Tag not found',
      });
    }

    const trimmedName = name.trim();
    const nameChanged = trimmedName !== tag.name;

    let nextSlug = tag.slug;
    if (slug !== undefined && slug !== null) {
      nextSlug = this.normalizeProvidedSlug(slug);
    } else if (nameChanged) {
      nextSlug = await this.ensureUniqueSlugForEntity(
        this.tagRepository,
        trimmedName,
        'tag',
        tagId,
      );
    }

    const slugChanged = nextSlug !== tag.slug;
    if (!nameChanged && !slugChanged) {
      return tag;
    }

    if (nameChanged) {
      const duplicate = await this.tagRepository.findOne({
        where: {
          name: ILike(trimmedName),
          approvalStatus: Not(TaxonomyApprovalStatus.REJECTED),
        },
      });

      if (duplicate && duplicate.id !== tagId) {
        throw this.duplicateNameError('แท็ก');
      }
    }

    if (slugChanged) {
      await this.assertUniqueSlug(this.tagRepository, nextSlug, tagId);
    }

    tag.name = trimmedName;
    tag.slug = nextSlug;

    try {
      return await this.tagRepository.save(tag);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('แท็ก');
      }
      throw error;
    }
  }

  async updateCategory(categoryId: string, name: string, slug?: string | null): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });

    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    const trimmedName = name.trim();
    const nameChanged = trimmedName !== category.name;

    let nextSlug = category.slug;
    if (slug !== undefined && slug !== null) {
      nextSlug = this.normalizeProvidedSlug(slug);
    } else if (nameChanged) {
      nextSlug = await this.ensureUniqueSlugForEntity(
        this.categoryRepository,
        trimmedName,
        'category',
        categoryId,
      );
    }

    const slugChanged = nextSlug !== category.slug;
    if (!nameChanged && !slugChanged) {
      return category;
    }

    if (nameChanged) {
      const duplicate = await this.categoryRepository.findOne({
        where: {
          name: ILike(trimmedName),
          approvalStatus: Not(TaxonomyApprovalStatus.REJECTED),
        },
      });

      if (duplicate && duplicate.id !== categoryId) {
        throw this.duplicateNameError('หมวดหมู่');
      }
    }

    if (slugChanged) {
      await this.assertUniqueSlug(this.categoryRepository, nextSlug, categoryId);
    }

    category.name = trimmedName;
    category.slug = nextSlug;

    try {
      return await this.categoryRepository.save(category);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('หมวดหมู่');
      }
      throw error;
    }
  }

  private async ensureUniqueSlugForEntity(
    repository: TaxonomyRepository,
    name: string,
    fallback: string,
    excludeId: string,
  ): Promise<string> {
    let slug = generateSlug(name, fallback);
    let exists = await repository.findOne({ where: { slug } });
    let counter = 1;

    while (exists && exists.id !== excludeId) {
      slug = `${generateSlug(name, fallback)}-${counter}`;
      exists = await repository.findOne({ where: { slug } });
      counter++;
    }

    return slug;
  }

  async setCategoryImage(categoryId: string, imageUrl: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });

    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    const trimmedImageUrl = imageUrl.trim();
    this.storageService.assertFolderImageUrl(trimmedImageUrl, 'categories');
    category.imageUrl = trimmedImageUrl;

    return this.categoryRepository.save(category);
  }

  async approveCategory(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    if (!category.imageUrl?.trim()) {
      throw new BadRequestException({
        code: 'CATEGORY_IMAGE_REQUIRED',
        message: 'ต้องอัปโหลดรูปภาพหมวดหมู่ก่อนอนุมัติ',
      });
    }

    return this.setCategoryStatus(id, TaxonomyApprovalStatus.APPROVED);
  }

  async rejectCategory(id: string): Promise<Category> {
    return this.setCategoryStatus(id, TaxonomyApprovalStatus.REJECTED);
  }

  async approveTag(id: string): Promise<Tag> {
    return this.setTagStatus(id, TaxonomyApprovalStatus.APPROVED);
  }

  async rejectTag(id: string): Promise<Tag> {
    return this.setTagStatus(id, TaxonomyApprovalStatus.REJECTED);
  }

  private async setCategoryStatus(
    id: string,
    approvalStatus: TaxonomyApprovalStatus,
  ): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    category.approvalStatus = approvalStatus;
    return this.categoryRepository.save(category);
  }

  private async setTagStatus(id: string, approvalStatus: TaxonomyApprovalStatus): Promise<Tag> {
    const tag = await this.tagRepository.findOne({ where: { id } });

    if (!tag) {
      throw new NotFoundException({
        code: 'TAG_NOT_FOUND',
        message: 'Tag not found',
      });
    }

    tag.approvalStatus = approvalStatus;
    return this.tagRepository.save(tag);
  }

  async getApprovedCategory(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }

    if (category.approvalStatus !== TaxonomyApprovalStatus.APPROVED) {
      throw new BadRequestException({
        code: 'CATEGORY_NOT_APPROVED',
        message: 'Only approved categories can be assigned to products',
      });
    }

    return category;
  }

  async getApprovedTags(ids: string[]): Promise<Tag[]> {
    if (!ids.length) {
      return [];
    }

    const uniqueIds = [...new Set(ids)];
    const tags = await this.tagRepository.find({
      where: { id: In(uniqueIds) },
    });

    if (tags.length !== uniqueIds.length) {
      throw new NotFoundException({
        code: 'TAG_NOT_FOUND',
        message: 'One or more tags were not found',
      });
    }

    const unapproved = tags.filter((tag) => tag.approvalStatus !== TaxonomyApprovalStatus.APPROVED);

    if (unapproved.length) {
      throw new BadRequestException({
        code: 'TAG_NOT_APPROVED',
        message: 'Only approved tags can be assigned to products',
      });
    }

    return tags;
  }

  /**
   * Resolve an approved category by its name (case-insensitive exact match).
   * Used by the public API where callers reference taxonomy by name, not id.
   * Throws a clear validation error when no approved category matches.
   */
  async getApprovedCategoryByName(name: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: {
        name: ILike(name.trim()),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });

    if (!category) {
      throw new BadRequestException({
        code: 'CATEGORY_NOT_FOUND',
        message: `ไม่พบหมวดหมู่ "${name}" ที่ได้รับการอนุมัติในระบบ`,
      });
    }

    return category;
  }

  /**
   * Resolve approved tags by their names (case-insensitive exact match).
   * Throws a validation error naming any tags that do not exist / are not
   * approved. Does NOT auto-create tags.
   */
  /**
   * Resolve an approved category for public listing filters.
   * Lookup order: exact slug, then case-insensitive name match.
   * Returns null when no approved category matches (caller returns empty listing).
   */
  async resolveApprovedCategoryFilter(category: string): Promise<Category | null> {
    const trimmed = category.trim();
    if (!trimmed) {
      return null;
    }

    const bySlug = await this.categoryRepository.findOne({
      where: {
        slug: trimmed,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });
    if (bySlug) {
      return bySlug;
    }

    return this.categoryRepository.findOne({
      where: {
        name: ILike(trimmed),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });
  }

  /**
   * Resolve an approved tag for public listing filters.
   * Lookup order: exact id (storefront UUID contract), exact slug, then ILike name.
   * Returns null when no approved tag matches (caller returns empty listing).
   */
  async resolveApprovedTagFilter(tag: string): Promise<Tag | null> {
    const trimmed = tag.trim();
    if (!trimmed) {
      return null;
    }

    const byId = await this.tagRepository.findOne({
      where: {
        id: trimmed,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });
    if (byId) {
      return byId;
    }

    const bySlug = await this.tagRepository.findOne({
      where: {
        slug: trimmed,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });
    if (bySlug) {
      return bySlug;
    }

    return this.tagRepository.findOne({
      where: {
        name: ILike(trimmed),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });
  }

  async getApprovedTagsByNames(names: string[]): Promise<Tag[]> {
    const cleaned = [...new Set(names.map((name) => name.trim()).filter(Boolean))];

    if (!cleaned.length) {
      return [];
    }

    const tags = await this.tagRepository.find({
      where: cleaned.map((name) => ({
        name: ILike(name),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      })),
    });

    const found = new Set(tags.map((tag) => tag.name.toLowerCase()));
    const missing = cleaned.filter((name) => !found.has(name.toLowerCase()));

    if (missing.length) {
      throw new BadRequestException({
        code: 'TAG_NOT_FOUND',
        message: `ไม่พบแท็กที่ได้รับการอนุมัติ: ${missing.join(', ')}`,
      });
    }

    return tags;
  }

  async findPetTypesByCreator(createdBy: string): Promise<PetType[]> {
    return this.petTypeRepository.find({
      where: { createdBy },
      order: { createdAt: 'DESC' },
    });
  }

  async findBrandsByCreator(createdBy: string): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { createdBy },
      order: { createdAt: 'DESC' },
    });
  }

  async findApprovedPetTypes(): Promise<PetType[]> {
    return this.petTypeRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.APPROVED },
      order: { name: 'ASC' },
    });
  }

  async findApprovedBrands(): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.APPROVED },
      order: { name: 'ASC' },
    });
  }

  async findPendingPetTypes(): Promise<PetType[]> {
    return this.petTypeRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingBrands(): Promise<Brand[]> {
    return this.brandRepository.find({
      where: { approvalStatus: TaxonomyApprovalStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async createPetType(
    name: string,
    createdBy: string,
    role: UserRole,
    imageUrl?: string | null,
  ): Promise<PetType> {
    await this.assertUniqueName(this.petTypeRepository, name, 'ประเภทสัตว์เลี้ยง');

    const slug = await this.ensureUniqueSlug(this.petTypeRepository, name, 'pet-type');

    const trimmedImageUrl = imageUrl?.trim() || null;
    if (trimmedImageUrl) {
      this.storageService.assertFolderImageUrl(trimmedImageUrl, 'pet-types');
    }

    const petType = this.petTypeRepository.create({
      name: name.trim(),
      slug,
      createdBy,
      approvalStatus: this.resolveApprovalStatus(role),
      imageUrl: trimmedImageUrl,
    });

    try {
      return await this.petTypeRepository.save(petType);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('ประเภทสัตว์เลี้ยง');
      }
      throw error;
    }
  }

  async createBrand(name: string, createdBy: string, role: string): Promise<Brand> {
    await this.assertUniqueName(this.brandRepository, name, 'แบรนด์');

    const slug = await this.ensureUniqueSlug(this.brandRepository, name, 'brand');

    const brand = this.brandRepository.create({
      name: name.trim(),
      slug,
      createdBy,
      approvalStatus: this.resolveApprovalStatus(role as UserRole),
    });

    try {
      return await this.brandRepository.save(brand);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('แบรนด์');
      }
      throw error;
    }
  }

  async updateBrand(brandId: string, name: string, slug?: string | null): Promise<Brand> {
    const brand = await this.brandRepository.findOne({ where: { id: brandId } });

    if (!brand) {
      throw new NotFoundException({
        code: 'BRAND_NOT_FOUND',
        message: 'Brand not found',
      });
    }

    const trimmedName = name.trim();
    const nameChanged = trimmedName !== brand.name;

    let nextSlug = brand.slug;
    if (slug !== undefined && slug !== null) {
      nextSlug = this.normalizeProvidedSlug(slug);
    } else if (nameChanged) {
      nextSlug = await this.ensureUniqueSlugForEntity(
        this.brandRepository,
        trimmedName,
        'brand',
        brandId,
      );
    }

    const slugChanged = nextSlug !== brand.slug;
    if (!nameChanged && !slugChanged) {
      return brand;
    }

    if (nameChanged) {
      const duplicate = await this.brandRepository.findOne({
        where: {
          name: ILike(trimmedName),
          approvalStatus: Not(TaxonomyApprovalStatus.REJECTED),
        },
      });

      if (duplicate && duplicate.id !== brandId) {
        throw this.duplicateNameError('แบรนด์');
      }
    }

    if (slugChanged) {
      await this.assertUniqueSlug(this.brandRepository, nextSlug, brandId);
    }

    brand.name = trimmedName;
    brand.slug = nextSlug;

    try {
      return await this.brandRepository.save(brand);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('แบรนด์');
      }
      throw error;
    }
  }

  async updatePetType(petTypeId: string, name: string, slug?: string | null): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({ where: { id: petTypeId } });

    if (!petType) {
      throw new NotFoundException({
        code: 'PET_TYPE_NOT_FOUND',
        message: 'Pet type not found',
      });
    }

    const trimmedName = name.trim();
    const nameChanged = trimmedName !== petType.name;

    let nextSlug = petType.slug;
    if (slug !== undefined && slug !== null) {
      nextSlug = this.normalizeProvidedSlug(slug);
    } else if (nameChanged) {
      nextSlug = await this.ensureUniqueSlugForEntity(
        this.petTypeRepository,
        trimmedName,
        'pet-type',
        petTypeId,
      );
    }

    const slugChanged = nextSlug !== petType.slug;
    if (!nameChanged && !slugChanged) {
      return petType;
    }

    if (nameChanged) {
      const duplicate = await this.petTypeRepository.findOne({
        where: {
          name: ILike(trimmedName),
          approvalStatus: Not(TaxonomyApprovalStatus.REJECTED),
        },
      });

      if (duplicate && duplicate.id !== petTypeId) {
        throw this.duplicateNameError('ประเภทสัตว์เลี้ยง');
      }
    }

    if (slugChanged) {
      await this.assertUniqueSlug(this.petTypeRepository, nextSlug, petTypeId);
    }

    petType.name = trimmedName;
    petType.slug = nextSlug;

    try {
      return await this.petTypeRepository.save(petType);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw this.duplicateNameError('ประเภทสัตว์เลี้ยง');
      }
      throw error;
    }
  }

  async setPetTypeImage(petTypeId: string, imageUrl: string): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({ where: { id: petTypeId } });

    if (!petType) {
      throw new NotFoundException({
        code: 'PET_TYPE_NOT_FOUND',
        message: 'Pet type not found',
      });
    }

    const trimmedImageUrl = imageUrl.trim();
    this.storageService.assertFolderImageUrl(trimmedImageUrl, 'pet-types');
    petType.imageUrl = trimmedImageUrl;

    return this.petTypeRepository.save(petType);
  }

  async approvePetType(id: string): Promise<PetType> {
    return this.setPetTypeStatus(id, TaxonomyApprovalStatus.APPROVED);
  }

  async rejectPetType(id: string): Promise<PetType> {
    return this.setPetTypeStatus(id, TaxonomyApprovalStatus.REJECTED);
  }

  async approveBrand(id: string): Promise<Brand> {
    return this.setBrandStatus(id, TaxonomyApprovalStatus.APPROVED);
  }

  async rejectBrand(id: string): Promise<Brand> {
    return this.setBrandStatus(id, TaxonomyApprovalStatus.REJECTED);
  }

  private async setPetTypeStatus(
    id: string,
    approvalStatus: TaxonomyApprovalStatus,
  ): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({ where: { id } });

    if (!petType) {
      throw new NotFoundException({
        code: 'PET_TYPE_NOT_FOUND',
        message: 'Pet type not found',
      });
    }

    petType.approvalStatus = approvalStatus;
    return this.petTypeRepository.save(petType);
  }

  private async setBrandStatus(id: string, approvalStatus: TaxonomyApprovalStatus): Promise<Brand> {
    const brand = await this.brandRepository.findOne({ where: { id } });

    if (!brand) {
      throw new NotFoundException({
        code: 'BRAND_NOT_FOUND',
        message: 'Brand not found',
      });
    }

    brand.approvalStatus = approvalStatus;
    return this.brandRepository.save(brand);
  }

  async getApprovedPetType(id: string): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({ where: { id } });

    if (!petType) {
      throw new NotFoundException({
        code: 'PET_TYPE_NOT_FOUND',
        message: 'Pet type not found',
      });
    }

    if (petType.approvalStatus !== TaxonomyApprovalStatus.APPROVED) {
      throw new BadRequestException({
        code: 'PET_TYPE_NOT_APPROVED',
        message: 'Only approved pet types can be assigned to products',
      });
    }

    return petType;
  }

  async getApprovedBrand(id: string): Promise<Brand> {
    const brand = await this.brandRepository.findOne({ where: { id } });

    if (!brand) {
      throw new NotFoundException({
        code: 'BRAND_NOT_FOUND',
        message: 'Brand not found',
      });
    }

    if (brand.approvalStatus !== TaxonomyApprovalStatus.APPROVED) {
      throw new BadRequestException({
        code: 'BRAND_NOT_APPROVED',
        message: 'Only approved brands can be assigned to products',
      });
    }

    return brand;
  }

  async getApprovedPetTypeByName(name: string): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({
      where: {
        name: ILike(name.trim()),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });

    if (!petType) {
      throw new BadRequestException({
        code: 'PET_TYPE_NOT_FOUND',
        message: `ไม่พบประเภทสัตว์เลี้ยง "${name}" ที่ได้รับการอนุมัติในระบบ`,
      });
    }

    return petType;
  }

  async getApprovedBrandByName(name: string): Promise<Brand> {
    const brand = await this.brandRepository.findOne({
      where: {
        name: ILike(name.trim()),
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      },
    });

    if (!brand) {
      throw new BadRequestException({
        code: 'BRAND_NOT_FOUND',
        message: `ไม่พบแบรนด์ "${name}" ที่ได้รับการอนุมัติในระบบ`,
      });
    }

    return brand;
  }

  async getCategoryDeleteImpact(categoryId: string): Promise<TaxonomyDeleteImpact> {
    await this.getCategoryOrThrow(categoryId);
    return this.buildDeleteImpact({ categoryId });
  }

  async getTagDeleteImpact(tagId: string): Promise<TaxonomyDeleteImpact> {
    await this.getTagOrThrow(tagId);
    return this.buildDeleteImpact({ tagId });
  }

  async getPetTypeDeleteImpact(petTypeId: string): Promise<TaxonomyDeleteImpact> {
    await this.getPetTypeOrThrow(petTypeId);
    return this.buildDeleteImpact({ petTypeId });
  }

  async getBrandDeleteImpact(brandId: string): Promise<TaxonomyDeleteImpact> {
    await this.getBrandOrThrow(brandId);
    return this.buildDeleteImpact({ brandId });
  }

  async deleteCategory(id: string, replacementCategoryId?: string): Promise<DeleteTaxonomyResult> {
    const category = await this.getCategoryOrThrow(id);
    const products = await this.findActiveProductsByCategoryId(id);

    if (products.length > 0) {
      if (!replacementCategoryId) {
        throw new BadRequestException({
          code: 'CATEGORY_REPLACEMENT_REQUIRED',
          message: 'Replacement category is required when products are bound to this category',
        });
      }

      if (replacementCategoryId === id) {
        throw new BadRequestException({
          code: 'CATEGORY_REPLACEMENT_INVALID',
          message: 'Replacement category must differ from the category being deleted',
        });
      }

      const replacement = await this.categoryRepository.findOne({
        where: {
          id: replacementCategoryId,
          approvalStatus: TaxonomyApprovalStatus.APPROVED,
        },
      });

      if (!replacement) {
        throw new BadRequestException({
          code: 'CATEGORY_REPLACEMENT_INVALID',
          message: 'Replacement category must be an approved category',
        });
      }

      const storeIds = [...new Set(products.map((product) => product.storeId))];
      const reassignedProductIds: string[] = [];

      await this.dataSource.transaction(async (manager) => {
        await manager
          .createQueryBuilder()
          .update(Product)
          .set({ categoryId: replacement.id, category: replacement.name })
          .where('category_id = :categoryId', { categoryId: id })
          .andWhere('deleted_at IS NULL')
          .execute();

        reassignedProductIds.push(
          ...products
            .filter((product) => product.status === ProductStatus.PUBLISHED)
            .map((product) => product.id),
        );

        await manager.delete(Category, id);
      });

      const notifiedStoreCount = await this.notificationsService.notifyVendorsAboutTaxonomyDeleted(
        storeIds,
        'category',
        category.name,
      );

      await this.enqueueEmbeddingsForProducts(reassignedProductIds);

      return {
        success: true,
        deletedId: id,
        deletedCategoryId: id,
        detachedProductCount: 0,
        reassignedProductCount: products.length,
        replacementCategoryId: replacement.id,
        notifiedStoreCount,
      };
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Category, id);
    });

    return {
      success: true,
      deletedId: id,
      deletedCategoryId: id,
      detachedProductCount: 0,
      reassignedProductCount: 0,
      replacementCategoryId: null,
      notifiedStoreCount: 0,
    };
  }

  async deleteTag(id: string): Promise<DeleteTaxonomyResult> {
    const tag = await this.getTagOrThrow(id);
    const products = await this.productRepository
      .createQueryBuilder('product')
      .innerJoin('product.taxonomyTags', 'tag', 'tag.id = :tagId', { tagId: id })
      .getMany();
    const storeIds = [...new Set(products.map((product) => product.storeId))];
    const tagNameLower = tag.name.toLowerCase();

    await this.dataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .delete()
        .from('product_tags')
        .where('tag_id = :tagId', { tagId: id })
        .execute();

      for (const product of products) {
        product.tags = product.tags.filter((name) => name.toLowerCase() !== tagNameLower);
      }
      if (products.length) {
        await manager.save(Product, products);
      }

      await manager.delete(Tag, id);
    });

    const notifiedStoreCount = await this.notificationsService.notifyVendorsAboutTaxonomyDeleted(
      storeIds,
      'tag',
      tag.name,
    );

    return {
      success: true,
      deletedId: id,
      detachedProductCount: products.length,
      notifiedStoreCount,
    };
  }

  async deletePetType(id: string): Promise<DeleteTaxonomyResult> {
    const petType = await this.getPetTypeOrThrow(id);
    const products = await this.productRepository.find({ where: { petTypeId: id } });
    const storeIds = [...new Set(products.map((product) => product.storeId))];

    await this.dataSource.transaction(async (manager) => {
      if (products.length) {
        await manager.update(Product, { petTypeId: id }, { petTypeId: null });
      }
      await manager.delete(PetType, id);
    });

    const notifiedStoreCount = await this.notificationsService.notifyVendorsAboutTaxonomyDeleted(
      storeIds,
      'pet_type',
      petType.name,
    );

    return {
      success: true,
      deletedId: id,
      detachedProductCount: products.length,
      notifiedStoreCount,
    };
  }

  async deleteBrand(id: string): Promise<DeleteTaxonomyResult> {
    const brand = await this.getBrandOrThrow(id);
    const products = await this.productRepository.find({ where: { brandId: id } });
    const storeIds = [...new Set(products.map((product) => product.storeId))];

    await this.dataSource.transaction(async (manager) => {
      if (products.length) {
        await manager.update(Product, { brandId: id }, { brandId: null });
      }
      await manager.delete(Brand, id);
    });

    const notifiedStoreCount = await this.notificationsService.notifyVendorsAboutTaxonomyDeleted(
      storeIds,
      'brand',
      brand.name,
    );

    return {
      success: true,
      deletedId: id,
      detachedProductCount: products.length,
      notifiedStoreCount,
    };
  }

  private async findActiveProductsByCategoryId(categoryId: string): Promise<Product[]> {
    return this.productRepository
      .createQueryBuilder('product')
      .where('product.category_id = :categoryId', { categoryId })
      .andWhere('product.deleted_at IS NULL')
      .getMany();
  }

  private async enqueueEmbeddingsForProducts(productIds: string[]): Promise<void> {
    if (!this.searchEmbeddingQueueService || productIds.length === 0) {
      return;
    }

    await Promise.all(
      productIds.map(async (productId) => {
        try {
          await this.searchEmbeddingQueueService!.enqueueProductEmbedding(productId);
        } catch {
          // Non-blocking post-commit enqueue; failures are retried by the queue worker.
        }
      }),
    );
  }

  private applyActiveProductFilter(
    qb: ReturnType<Repository<Product>['createQueryBuilder']>,
  ): ReturnType<Repository<Product>['createQueryBuilder']> {
    return qb.andWhere('product.deleted_at IS NULL');
  }

  private async getCategoryOrThrow(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({ where: { id } });
    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found',
      });
    }
    return category;
  }

  private async getTagOrThrow(id: string): Promise<Tag> {
    const tag = await this.tagRepository.findOne({ where: { id } });
    if (!tag) {
      throw new NotFoundException({
        code: 'TAG_NOT_FOUND',
        message: 'Tag not found',
      });
    }
    return tag;
  }

  private async getPetTypeOrThrow(id: string): Promise<PetType> {
    const petType = await this.petTypeRepository.findOne({ where: { id } });
    if (!petType) {
      throw new NotFoundException({
        code: 'PET_TYPE_NOT_FOUND',
        message: 'Pet type not found',
      });
    }
    return petType;
  }

  private async getBrandOrThrow(id: string): Promise<Brand> {
    const brand = await this.brandRepository.findOne({ where: { id } });
    if (!brand) {
      throw new NotFoundException({
        code: 'BRAND_NOT_FOUND',
        message: 'Brand not found',
      });
    }
    return brand;
  }

  private async buildDeleteImpact(filter: {
    categoryId?: string;
    tagId?: string;
    petTypeId?: string;
    brandId?: string;
  }): Promise<TaxonomyDeleteImpact> {
    let qb = this.productRepository
      .createQueryBuilder('product')
      .select(['product.id', 'product.name', 'product.slug'])
      .orderBy('product.name', 'ASC')
      .take(10);

    if (filter.categoryId) {
      qb = qb.where('product.category_id = :categoryId', { categoryId: filter.categoryId });
      qb = this.applyActiveProductFilter(qb);
    } else if (filter.petTypeId) {
      qb = qb.where('product.pet_type_id = :petTypeId', { petTypeId: filter.petTypeId });
      qb = this.applyActiveProductFilter(qb);
    } else if (filter.brandId) {
      qb = qb.where('product.brand_id = :brandId', { brandId: filter.brandId });
      qb = this.applyActiveProductFilter(qb);
    } else if (filter.tagId) {
      qb = qb.innerJoin('product.taxonomyTags', 'tag', 'tag.id = :tagId', {
        tagId: filter.tagId,
      });
      qb = this.applyActiveProductFilter(qb);
    }

    const products = await qb.getMany();
    const countQb = this.productRepository.createQueryBuilder('product');

    if (filter.categoryId) {
      countQb.where('product.category_id = :categoryId', { categoryId: filter.categoryId });
      this.applyActiveProductFilter(countQb);
    } else if (filter.petTypeId) {
      countQb.where('product.pet_type_id = :petTypeId', { petTypeId: filter.petTypeId });
      this.applyActiveProductFilter(countQb);
    } else if (filter.brandId) {
      countQb.where('product.brand_id = :brandId', { brandId: filter.brandId });
      this.applyActiveProductFilter(countQb);
    } else if (filter.tagId) {
      countQb.innerJoin('product.taxonomyTags', 'tag', 'tag.id = :tagId', {
        tagId: filter.tagId,
      });
      this.applyActiveProductFilter(countQb);
    }

    const productCount = await countQb.getCount();

    return {
      productCount,
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        slug: product.slug,
      })),
    };
  }
}
