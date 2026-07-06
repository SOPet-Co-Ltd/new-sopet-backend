import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, QueryFailedError, Repository } from 'typeorm';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import { UserRole } from '../../database/entities/user.entity';
import { generateSlug } from '../../common/utils/slug.util';

@Injectable()
export class TaxonomyService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  private async ensureUniqueSlug(
    repository: Repository<Category | Tag>,
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
    repository: Repository<Category | Tag>,
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

  private resolveApprovalStatus(role: string): TaxonomyApprovalStatus {
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

  async createCategory(name: string, createdBy: string, role: string): Promise<Category> {
    await this.assertUniqueName(this.categoryRepository, name, 'หมวดหมู่');

    const slug = await this.ensureUniqueSlug(this.categoryRepository, name, 'category');

    const category = this.categoryRepository.create({
      name: name.trim(),
      slug,
      createdBy,
      approvalStatus: this.resolveApprovalStatus(role),
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

  async createTag(name: string, createdBy: string, role: string): Promise<Tag> {
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

  async approveCategory(id: string): Promise<Category> {
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
}
