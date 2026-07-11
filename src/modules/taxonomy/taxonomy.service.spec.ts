import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { TaxonomyService } from './taxonomy.service';
import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import { UserRole } from '../../database/entities/user.entity';
import { ProductStatus } from '../../database/entities/product.entity';
import { StorageService } from '../storage/storage.service';

const CATEGORY_IMAGE_REQUIRED_MESSAGE = 'ต้องอัปโหลดรูปภาพหมวดหมู่ก่อนอนุมัติ';
const VALID_CATEGORY_IMAGE_URL =
  'https://cdn.example.com/categories/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp';

describe('TaxonomyService', () => {
  let service: TaxonomyService;
  let categoryRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let tagRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let storageService: {
    assertFolderImageUrl: jest.Mock;
  };
  let petTypeRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let brandRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let productRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dataSource: {
    transaction: jest.Mock;
  };
  let notificationsService: {
    notifyTaxonomyApproval: jest.Mock;
    notifyVendorsAboutTaxonomyDeleted: jest.Mock;
  };
  let searchEmbeddingQueueService: {
    enqueueProductEmbedding: jest.Mock;
  };

  beforeEach(() => {
    categoryRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(<T extends object>(data: T) => data),
      save: jest.fn(<T extends { id?: string }>(data: T) => ({ ...data, id: data.id ?? 'cat-1' })),
    };
    tagRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(<T extends object>(data: T) => data),
      save: jest.fn(<T extends { id?: string }>(data: T) => ({ ...data, id: data.id ?? 'tag-1' })),
    };
    storageService = {
      assertFolderImageUrl: jest.fn(),
    };
    petTypeRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(<T extends object>(data: T) => data),
      save: jest.fn(<T extends { id?: string }>(data: T) => ({ ...data, id: data.id ?? 'pet-1' })),
    };
    brandRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(<T extends object>(data: T) => data),
      save: jest.fn(<T extends { id?: string }>(data: T) => ({
        ...data,
        id: data.id ?? 'brand-1',
      })),
    };
    productRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn((callback: (manager: unknown) => unknown) =>
        callback({ delete: jest.fn(), createQueryBuilder: jest.fn() }),
      ),
    };
    notificationsService = {
      notifyTaxonomyApproval: jest.fn(),
      notifyVendorsAboutTaxonomyDeleted: jest.fn().mockResolvedValue(1),
    };
    searchEmbeddingQueueService = {
      enqueueProductEmbedding: jest.fn().mockResolvedValue(undefined),
    };

    service = new TaxonomyService(
      categoryRepository as never,
      tagRepository as never,
      petTypeRepository as never,
      brandRepository as never,
      productRepository as never,
      dataSource as never,
      storageService as unknown as StorageService,
      notificationsService as never,
      searchEmbeddingQueueService as never,
    );
  });

  it('creates approved category for admin', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    const category = await service.createCategory('Cat Food', 'admin-1', UserRole.ADMIN);

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
    expect(category.imageUrl ?? null).toBeNull();
    expect(category.slug).toBe('cat-food');
    expect(categoryRepository.save).toHaveBeenCalled();
  });

  it('creates pending category for vendor', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    const category = await service.createCategory('Dog Treats', 'vendor-1', UserRole.VENDOR);

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.PENDING);
  });

  it('creates approved tag for admin', async () => {
    tagRepository.findOne.mockResolvedValue(null);

    const tag = await service.createTag('Puppy', 'admin-1', UserRole.ADMIN);

    expect(tag.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
  });

  it('rejects duplicate category name (case-insensitive) with a conflict', async () => {
    categoryRepository.findOne.mockResolvedValue({ id: 'existing', name: 'Cat Food' });

    await expect(
      service.createCategory('cat food', 'vendor-1', UserRole.VENDOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(categoryRepository.save).not.toHaveBeenCalled();
  });

  it('rejects duplicate tag name (case-insensitive) with a conflict', async () => {
    tagRepository.findOne.mockResolvedValue({ id: 'existing', name: 'Puppy' });

    await expect(service.createTag('PUPPY', 'vendor-1', UserRole.VENDOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tagRepository.save).not.toHaveBeenCalled();
  });

  it('translates a DB unique violation into a conflict error', async () => {
    categoryRepository.findOne.mockResolvedValue(null);
    categoryRepository.save.mockRejectedValue(
      new QueryFailedError('query', [], {
        code: '23505',
      } as unknown as Error),
    );

    await expect(
      service.createCategory('Cat Food', 'vendor-1', UserRole.VENDOR),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects approveCategory when imageUrl is missing', async () => {
    categoryRepository.findOne.mockResolvedValue({
      id: 'cat-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
      imageUrl: null,
    });

    await expect(service.approveCategory('cat-1')).rejects.toMatchObject({
      response: {
        code: 'CATEGORY_IMAGE_REQUIRED',
        message: CATEGORY_IMAGE_REQUIRED_MESSAGE,
      },
    });
    expect(categoryRepository.save).not.toHaveBeenCalled();
  });

  it('approves category when imageUrl is set', async () => {
    categoryRepository.findOne.mockResolvedValue({
      id: 'cat-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
      imageUrl: VALID_CATEGORY_IMAGE_URL,
    });

    const category = await service.approveCategory('cat-1');

    expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
  });

  it('persists imageUrl via setCategoryImage and allows approval', async () => {
    categoryRepository.findOne.mockResolvedValue({
      id: 'cat-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
      imageUrl: null,
    });
    categoryRepository.save.mockImplementation((data: { imageUrl?: string | null }) => data);

    const updated = await service.setCategoryImage('cat-1', VALID_CATEGORY_IMAGE_URL);

    expect(storageService.assertFolderImageUrl).toHaveBeenCalledWith(
      VALID_CATEGORY_IMAGE_URL,
      'categories',
    );
    expect(updated.imageUrl).toBe(VALID_CATEGORY_IMAGE_URL);

    categoryRepository.findOne.mockResolvedValue({
      id: 'cat-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
      imageUrl: VALID_CATEGORY_IMAGE_URL,
    });

    const approved = await service.approveCategory('cat-1');

    expect(approved.approvalStatus).toBe(TaxonomyApprovalStatus.APPROVED);
  });

  it('rejects unapproved tags for product assignment', async () => {
    tagRepository.findOne.mockResolvedValue({
      id: 'tag-1',
      approvalStatus: TaxonomyApprovalStatus.PENDING,
    });
    tagRepository.find.mockResolvedValue([
      { id: 'tag-1', approvalStatus: TaxonomyApprovalStatus.PENDING },
    ]);

    await expect(service.getApprovedTags(['tag-1'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws when category is missing', async () => {
    categoryRepository.findOne.mockResolvedValue(null);

    await expect(service.getApprovedCategory('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('resolveApprovedCategoryFilter', () => {
    it('resolves by slug before name', async () => {
      const category = {
        id: 'cat-1',
        slug: 'dog-food',
        name: 'Dog Food',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      };
      categoryRepository.findOne.mockResolvedValueOnce(category);

      const result = await service.resolveApprovedCategoryFilter('dog-food');

      expect(result).toEqual(category);
      expect(categoryRepository.findOne).toHaveBeenCalledWith({
        where: {
          slug: 'dog-food',
          approvalStatus: TaxonomyApprovalStatus.APPROVED,
        },
      });
    });

    it('falls back to case-insensitive name when slug misses', async () => {
      const category = {
        id: 'cat-2',
        slug: 'dog-food',
        name: 'Dog Food',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      };
      categoryRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(category);

      const result = await service.resolveApprovedCategoryFilter('Dog Food');

      expect(result).toEqual(category);
      expect(categoryRepository.findOne).toHaveBeenNthCalledWith(2, {
        where: {
          name: expect.objectContaining({ _type: 'ilike', _value: 'Dog Food' }) as unknown,
          approvalStatus: TaxonomyApprovalStatus.APPROVED,
        },
      });
    });

    it('returns null when no approved category matches', async () => {
      categoryRepository.findOne.mockResolvedValue(null);

      const result = await service.resolveApprovedCategoryFilter('missing');

      expect(result).toBeNull();
    });
  });

  describe('resolveApprovedTagFilter', () => {
    it('resolves by id before slug and name', async () => {
      const tag = {
        id: 'tag-uuid',
        slug: 'organic',
        name: 'Organic',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      };
      tagRepository.findOne.mockResolvedValueOnce(tag);

      const result = await service.resolveApprovedTagFilter('tag-uuid');

      expect(result).toEqual(tag);
      expect(tagRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: 'tag-uuid',
          approvalStatus: TaxonomyApprovalStatus.APPROVED,
        },
      });
    });

    it('falls back to slug then name', async () => {
      const tag = {
        id: 'tag-2',
        slug: 'organic',
        name: 'Organic',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      };
      tagRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(tag);

      const result = await service.resolveApprovedTagFilter('Organic');

      expect(result).toEqual(tag);
      expect(tagRepository.findOne).toHaveBeenCalledTimes(3);
    });

    it('returns null when no approved tag matches', async () => {
      tagRepository.findOne.mockResolvedValue(null);

      const result = await service.resolveApprovedTagFilter('unknown-uuid');

      expect(result).toBeNull();
    });
  });

  describe('findRejectedCategories / findRejectedTags', () => {
    it('returns only rejected taxonomy with expected ordering', async () => {
      categoryRepository.find.mockResolvedValue([
        { id: 'cat-r2', name: 'B', approvalStatus: TaxonomyApprovalStatus.REJECTED },
        { id: 'cat-r1', name: 'A', approvalStatus: TaxonomyApprovalStatus.REJECTED },
      ]);
      tagRepository.find.mockResolvedValue([
        { id: 'tag-r2', createdAt: new Date('2024-02-02') },
        { id: 'tag-r1', createdAt: new Date('2024-02-01') },
      ]);

      await service.findRejectedCategories();
      await service.findRejectedTags();

      expect(categoryRepository.find).toHaveBeenCalledWith({
        where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
        order: { name: 'ASC' },
      });
      expect(tagRepository.find).toHaveBeenCalledWith({
        where: { approvalStatus: TaxonomyApprovalStatus.REJECTED },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns empty arrays when no rejected rows exist', async () => {
      categoryRepository.find.mockResolvedValue([]);
      tagRepository.find.mockResolvedValue([]);

      await expect(service.findRejectedCategories()).resolves.toEqual([]);
      await expect(service.findRejectedTags()).resolves.toEqual([]);
    });
  });

  describe('deleteCategory reassignment', () => {
    const sourceCategory = {
      id: 'cat-source',
      name: 'Source',
      approvalStatus: TaxonomyApprovalStatus.APPROVED,
    };
    const replacementCategory = {
      id: 'cat-replacement',
      name: 'Replacement',
      approvalStatus: TaxonomyApprovalStatus.APPROVED,
    };

    function mockActiveProducts(
      products: Array<{ id: string; storeId: string; status: ProductStatus }>,
    ) {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(products),
      };
      productRepository.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    beforeEach(() => {
      categoryRepository.findOne.mockImplementation(({ where }: { where: { id: string } }) => {
        if (where.id === sourceCategory.id) {
          return sourceCategory;
        }
        if (where.id === replacementCategory.id) {
          return replacementCategory;
        }
        return null;
      });
    });

    it('requires replacement when active products are bound', async () => {
      mockActiveProducts([{ id: 'prod-1', storeId: 'store-1', status: ProductStatus.PUBLISHED }]);

      await expect(service.deleteCategory(sourceCategory.id)).rejects.toMatchObject({
        response: { code: 'CATEGORY_REPLACEMENT_REQUIRED' },
      });
    });

    it('rejects invalid replacement category', async () => {
      mockActiveProducts([{ id: 'prod-1', storeId: 'store-1', status: ProductStatus.PUBLISHED }]);

      await expect(
        service.deleteCategory(sourceCategory.id, sourceCategory.id),
      ).rejects.toMatchObject({
        response: { code: 'CATEGORY_REPLACEMENT_INVALID' },
      });

      categoryRepository.findOne.mockResolvedValueOnce(sourceCategory).mockResolvedValueOnce(null);

      await expect(
        service.deleteCategory(sourceCategory.id, 'missing-replacement'),
      ).rejects.toMatchObject({
        response: { code: 'CATEGORY_REPLACEMENT_INVALID' },
      });
    });

    it('reassigns products and returns extended delete result fields', async () => {
      mockActiveProducts([
        { id: 'prod-1', storeId: 'store-1', status: ProductStatus.PUBLISHED },
        { id: 'prod-2', storeId: 'store-1', status: ProductStatus.DRAFT },
      ]);

      const execute = jest.fn().mockResolvedValue({ affected: 2 });
      const managerDelete = jest.fn();
      dataSource.transaction.mockImplementation((callback: (manager: unknown) => unknown) =>
        callback({
          createQueryBuilder: () => ({
            update: () => ({
              set: () => ({
                where: () => ({
                  andWhere: () => ({ execute }),
                }),
              }),
            }),
          }),
          delete: managerDelete,
        }),
      );

      const result = await service.deleteCategory(sourceCategory.id, replacementCategory.id);

      expect(result).toMatchObject({
        success: true,
        deletedId: sourceCategory.id,
        deletedCategoryId: sourceCategory.id,
        reassignedProductCount: 2,
        replacementCategoryId: replacementCategory.id,
        detachedProductCount: 0,
      });
      expect(searchEmbeddingQueueService.enqueueProductEmbedding).toHaveBeenCalledWith('prod-1');
      expect(searchEmbeddingQueueService.enqueueProductEmbedding).not.toHaveBeenCalledWith(
        'prod-2',
      );
    });

    it('deletes empty categories without replacement', async () => {
      mockActiveProducts([]);
      const managerDelete = jest.fn();
      dataSource.transaction.mockImplementation((callback: (manager: unknown) => unknown) =>
        callback({
          delete: managerDelete,
        }),
      );

      const result = await service.deleteCategory(sourceCategory.id);

      expect(result).toMatchObject({
        success: true,
        deletedId: sourceCategory.id,
        deletedCategoryId: sourceCategory.id,
        reassignedProductCount: 0,
        replacementCategoryId: null,
      });
      expect(managerDelete).toHaveBeenCalled();
    });
  });

  describe('buildDeleteImpact soft-delete exclusion', () => {
    it('applies deleted_at IS NULL to category impact queries', async () => {
      categoryRepository.findOne.mockResolvedValue({
        id: 'cat-1',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      });

      const previewQb = {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      const countQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };

      productRepository.createQueryBuilder
        .mockReturnValueOnce(previewQb)
        .mockReturnValueOnce(countQb);

      await service.getCategoryDeleteImpact('cat-1');

      expect(previewQb.andWhere).toHaveBeenCalledWith('product.deleted_at IS NULL');
      expect(countQb.andWhere).toHaveBeenCalledWith('product.deleted_at IS NULL');
    });
  });
});
