import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductStatus } from '../../database/entities/product.entity';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepository: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    softDelete: jest.Mock;
  };
  let variantRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let imageRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let storesService: {
    userHasStoreAccess: jest.Mock;
    resolveDefaultStoreId: jest.Mock;
  };
  let taxonomyService: {
    getApprovedCategory: jest.Mock;
    getApprovedTags: jest.Mock;
    getApprovedCategoryByName: jest.Mock;
    getApprovedTagsByNames: jest.Mock;
    resolveApprovedCategoryFilter: jest.Mock;
    resolveApprovedTagFilter: jest.Mock;
  };

  const product = {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'Dog Food',
    slug: 'dog-food',
    status: ProductStatus.DRAFT,
  };

  beforeEach(() => {
    productRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: data.id ?? 'prod-1' })),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn(),
    };
    variantRepository = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: 'var-1' })),
      softDelete: jest.fn(),
    };
    imageRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(async ({ where }) => ({ id: where.id })),
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ ...data, id: 'img-1' })),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
    };
    storesService = {
      userHasStoreAccess: jest.fn(async (userId: string, storeId: string) => {
        return userId === 'user-1' && storeId === 'store-1';
      }),
      resolveDefaultStoreId: jest.fn(async () => 'store-1'),
    };
    taxonomyService = {
      getApprovedCategory: jest.fn(),
      getApprovedTags: jest.fn(async () => []),
      getApprovedCategoryByName: jest.fn(),
      getApprovedTagsByNames: jest.fn(async () => []),
      resolveApprovedCategoryFilter: jest.fn(async () => null),
      resolveApprovedTagFilter: jest.fn(async () => null),
    };

    service = new ProductsService(
      productRepository as never,
      variantRepository as never,
      imageRepository as never,
      storesService as never,
      taxonomyService as never,
    );
  });

  it('creates product with generated slug', async () => {
    productRepository.findOne.mockResolvedValue(null);

    const result = await service.create('user-1', 'store-1', {
      name: 'Dog Food',
      basePrice: 299,
    });

    expect(result.slug).toBe('dog-food');
    expect(result.storeId).toBe('store-1');
  });

  it('throws when product not found', async () => {
    productRepository.findOne.mockResolvedValue(null);

    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('forbids update from another store', async () => {
    productRepository.findOne.mockResolvedValue(product);

    await expect(service.update('prod-1', 'user-other', { name: 'Hacked' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('updates own product', async () => {
    productRepository.findOne.mockResolvedValue({ ...product });
    productRepository.save.mockImplementation(async (p) => p);

    const result = await service.update('prod-1', 'user-1', {
      name: 'Premium Dog Food',
    });

    expect(result.name).toBe('Premium Dog Food');
  });

  it('preserves status when update omits status (undefined)', async () => {
    productRepository.findOne.mockResolvedValue({ ...product, status: ProductStatus.DRAFT });
    productRepository.save.mockImplementation(async (p) => p);

    const result = await service.update('prod-1', 'user-1', {
      name: 'Premium Dog Food',
      status: undefined,
    });

    expect(result.name).toBe('Premium Dog Food');
    expect(result.status).toBe(ProductStatus.DRAFT);
  });

  it('forces draft status on create even when status is requested', async () => {
    productRepository.findOne.mockResolvedValue(null);

    await service.create('user-1', 'store-1', {
      name: 'Dog Food',
      basePrice: 299,
      status: ProductStatus.PUBLISHED,
    });

    expect(productRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ProductStatus.DRAFT }),
    );
  });

  it('rejects publishing an incomplete product', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      name: '',
      images: [],
      variants: [],
      categoryId: null,
    });
    productRepository.save.mockImplementation(async (p) => p);

    await expect(
      service.update('prod-1', 'user-1', { status: ProductStatus.PUBLISHED }),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_PUBLISHABLE' } });
  });

  it('allows publishing a complete product', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      basePrice: 299,
      categoryId: 'cat-1',
      petTypeId: 'pet-1',
      images: [{ id: 'img-1' }],
      variants: [{ id: 'var-1', stockQuantity: 5, priceAdjustment: 0 }],
    });
    productRepository.save.mockImplementation(async (p) => p);

    const result = await service.update('prod-1', 'user-1', {
      status: ProductStatus.PUBLISHED,
    });

    expect(result.status).toBe(ProductStatus.PUBLISHED);
  });

  it('hides non-published products from public findOne', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      status: ProductStatus.DRAFT,
    });

    await expect(service.findOnePublished('prod-1')).rejects.toThrow(NotFoundException);
  });

  it('publish sets status when checklist passes', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      basePrice: 299,
      categoryId: 'cat-1',
      petTypeId: 'pet-1',
      images: [{ id: 'img-1' }],
      variants: [{ id: 'var-1', stockQuantity: 5, priceAdjustment: 0 }],
    });
    productRepository.save.mockImplementation(async (p) => p);

    const result = await service.publish('prod-1', 'user-1');
    expect(result.status).toBe(ProductStatus.PUBLISHED);
  });

  it('rejects duplicate SKU when adding variant', async () => {
    productRepository.findOne.mockResolvedValue(product);
    variantRepository.findOne.mockResolvedValue({ id: 'existing', sku: 'SKU-1' });

    await expect(
      service.addVariant('prod-1', 'user-1', {
        sku: 'SKU-1',
        price: 100,
        stockQuantity: 5,
      }),
    ).rejects.toMatchObject({ response: { code: 'SKU_EXISTS' } });
  });

  it('adds variant to own product', async () => {
    productRepository.findOne.mockResolvedValue(product);
    variantRepository.findOne.mockResolvedValue(null);

    const variant = await service.addVariant('prod-1', 'user-1', {
      sku: 'SKU-NEW',
      price: 150,
      stockQuantity: 10,
    });

    expect(variant.id).toBe('var-1');
    expect(variantRepository.save).toHaveBeenCalled();
  });

  it('finds product by slug', async () => {
    productRepository.findOne.mockResolvedValue(product);

    const result = await service.findBySlug('store-1', 'dog-food');
    expect(result.slug).toBe('dog-food');
  });

  it('soft deletes own product', async () => {
    productRepository.findOne.mockResolvedValue(product);

    await service.remove('prod-1', 'user-1');

    expect(productRepository.softDelete).toHaveBeenCalledWith('prod-1');
  });

  it('lists products with pagination', async () => {
    const idQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 'prod-1' }]),
    };
    const countQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ cnt: '1' }),
    };
    const hydrateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([product]),
    };
    productRepository.createQueryBuilder
      .mockReturnValueOnce(idQb)
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(hydrateQb);

    const result = await service.findAll({ page: 1, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
  });

  it('preserves relevance sort select columns in phase A id query', async () => {
    const idQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 'prod-1' }]),
    };
    const countQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ cnt: '1' }),
    };
    const hydrateQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([product]),
    };
    productRepository.createQueryBuilder
      .mockReturnValueOnce(idQb)
      .mockReturnValueOnce(countQb)
      .mockReturnValueOnce(hydrateQb);

    await service.findAll({
      search: 'dog food',
      sortBy: 'relevance',
      sortOrder: 'DESC',
      page: 1,
      limit: 10,
    });

    expect(idQb.select).toHaveBeenCalledTimes(1);
    expect(idQb.select).toHaveBeenCalledWith('product.id', 'id');
    expect(idQb.addSelect).toHaveBeenCalledWith(
      'CASE WHEN product.name ILIKE :relevancePrefix THEN 0 WHEN product.name ILIKE :relevanceContains THEN 1 ELSE 2 END',
      'relevance_rank',
    );
    expect(idQb.addSelect).toHaveBeenCalledWith('product.createdAt', 'product_created_at');
    expect(idQb.distinct).not.toHaveBeenCalled();
  });

  it('short-circuits to empty listing when category filter is unresolvable', async () => {
    taxonomyService.resolveApprovedCategoryFilter.mockResolvedValue(null);

    const result = await service.findAll({
      category: 'nonexistent-slug',
      page: 1,
      limit: 10,
    });

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(productRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('short-circuits to empty listing when tag filter is unresolvable', async () => {
    taxonomyService.resolveApprovedTagFilter.mockResolvedValue(null);

    const result = await service.findAll({
      tag: '00000000-0000-0000-0000-000000000000',
      page: 1,
      limit: 10,
    });

    expect(result.items).toEqual([]);
    expect(result.pagination.total).toBe(0);
    expect(productRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('applies resolved categoryId and approved-store join in legacy listing filters', async () => {
    taxonomyService.resolveApprovedCategoryFilter.mockResolvedValue({
      id: 'cat-resolved',
      slug: 'dog-food',
      name: 'Dog Food',
    });

    const idQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const countQb = {
      andWhere: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
    };
    productRepository.createQueryBuilder.mockReturnValueOnce(idQb).mockReturnValueOnce(countQb);

    await service.findAll({
      category: 'dog-food',
      status: ProductStatus.PUBLISHED,
      page: 1,
      limit: 10,
    });

    expect(taxonomyService.resolveApprovedCategoryFilter).toHaveBeenCalledWith('dog-food');
    expect(idQb.innerJoin).toHaveBeenCalledWith('product.store', 'store');
    expect(idQb.andWhere).toHaveBeenCalledWith('store.status = :approvedStoreStatus', {
      approvedStoreStatus: 'approved',
    });
    expect(idQb.andWhere).toHaveBeenCalledWith('product.categoryId = :categoryId', {
      categoryId: 'cat-resolved',
    });
  });

  it('updates variant for own product', async () => {
    const variant = {
      id: 'var-1',
      product: { storeId: 'store-1' },
      stockQuantity: 5,
    };
    variantRepository.findOne.mockResolvedValue(variant);
    variantRepository.save.mockImplementation(async (v) => v);

    const result = await service.updateVariant('var-1', 'user-1', {
      stockQuantity: 10,
    });
    expect(result.stockQuantity).toBe(10);
  });

  it('rejects variant update from another store', async () => {
    variantRepository.findOne.mockResolvedValue({
      id: 'var-1',
      product: { storeId: 'store-other' },
    });

    await expect(service.updateVariant('var-1', 'user-1', { price: 120 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('adds image to own product', async () => {
    productRepository.findOne.mockResolvedValue(product);

    const image = await service.addImage('prod-1', 'user-1', 'https://cdn/img.jpg', 1);

    expect(image.id).toBe('img-1');
    expect(imageRepository.save).toHaveBeenCalled();
  });

  it('removes variant from own product', async () => {
    variantRepository.findOne.mockResolvedValue({
      id: 'var-1',
      product: { storeId: 'store-1' },
    });

    await service.removeVariant('var-1', 'user-1');

    expect(variantRepository.softDelete).toHaveBeenCalledWith('var-1');
  });

  it('generates unique slug when duplicate exists', async () => {
    productRepository.findOne.mockResolvedValueOnce({ id: 'existing' }).mockResolvedValueOnce(null);

    const result = await service.create('user-1', 'store-1', { name: 'Dog Food', basePrice: 100 });

    expect(result.slug).toBe('dog-food-1');
  });

  describe('createWithVariants', () => {
    const baseInput = {
      name: 'Organic Cat Food',
      variants: [{ name: 'Flavour', values: ['Chicken'] }],
      variantItems: [{ sku: 'CAT-1', stock: 10, price: 199, options: { Flavour: 'Chicken' } }],
    };

    it('rejects when no variant option groups are provided', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [],
          variantItems: [{ sku: 'A', stock: 1, price: 10, options: {} }],
        }),
      ).rejects.toMatchObject({ response: { code: 'VARIANTS_REQUIRED' } });
    });

    it('rejects when no variant items are provided', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [{ name: 'Flavour', values: ['Chicken'] }],
          variantItems: [],
        }),
      ).rejects.toMatchObject({ response: { code: 'VARIANT_ITEMS_REQUIRED' } });
    });

    it('rejects a variant item with an option value outside the group', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [{ name: 'Flavour', values: ['Chicken'] }],
          variantItems: [{ sku: 'A', stock: 1, price: 10, options: { Flavour: 'Beef' } }],
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_VARIANT_OPTIONS' } });
    });

    it('rejects a variant item missing a declared group', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [
            { name: 'Flavour', values: ['Chicken'] },
            { name: 'Size', values: ['S'] },
          ],
          variantItems: [{ sku: 'A', stock: 1, price: 10, options: { Flavour: 'Chicken' } }],
        }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_VARIANT_OPTIONS' } });
    });

    it('rejects duplicate SKUs within the request', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [{ name: 'Flavour', values: ['Chicken', 'Fish'] }],
          variantItems: [
            { sku: 'DUP', stock: 1, price: 10, options: { Flavour: 'Chicken' } },
            { sku: 'DUP', stock: 2, price: 20, options: { Flavour: 'Fish' } },
          ],
        }),
      ).rejects.toMatchObject({ response: { code: 'SKU_EXISTS' } });
    });

    it('rejects duplicate option combinations', async () => {
      await expect(
        service.createWithVariants('user-1', 'store-1', {
          name: 'Cat Food',
          variants: [{ name: 'Flavour', values: ['Chicken'] }],
          variantItems: [
            { sku: 'A', stock: 1, price: 10, options: { Flavour: 'Chicken' } },
            { sku: 'B', stock: 2, price: 20, options: { Flavour: 'Chicken' } },
          ],
        }),
      ).rejects.toMatchObject({ response: { code: 'DUPLICATE_VARIANT_COMBINATION' } });
    });

    it('throws when the category name does not exist', async () => {
      variantRepository.findOne.mockResolvedValue(null);
      taxonomyService.getApprovedCategoryByName.mockRejectedValue(
        new BadRequestException({ code: 'CATEGORY_NOT_FOUND', message: 'nope' }),
      );

      await expect(
        service.createWithVariants('user-1', 'store-1', {
          ...baseInput,
          category: 'Missing Category',
        }),
      ).rejects.toMatchObject({ response: { code: 'CATEGORY_NOT_FOUND' } });
    });

    it('throws when a tag name does not exist', async () => {
      variantRepository.findOne.mockResolvedValue(null);
      taxonomyService.getApprovedTagsByNames.mockRejectedValue(
        new BadRequestException({ code: 'TAG_NOT_FOUND', message: 'nope' }),
      );

      await expect(
        service.createWithVariants('user-1', 'store-1', {
          ...baseInput,
          tags: ['unknown-tag'],
        }),
      ).rejects.toMatchObject({ response: { code: 'TAG_NOT_FOUND' } });
    });

    it('rejects when a SKU already exists', async () => {
      variantRepository.findOne.mockResolvedValue({ id: 'v0', sku: 'CAT-1' });

      await expect(
        service.createWithVariants('user-1', 'store-1', baseInput),
      ).rejects.toMatchObject({ response: { code: 'SKU_EXISTS' } });
    });

    it('creates a product with variant items and derives base price', async () => {
      productRepository.findOne.mockImplementation(async ({ where }) => {
        if (where?.id) {
          return { id: 'prod-1', storeId: 'store-1', variants: [] };
        }
        return null;
      });
      variantRepository.findOne.mockResolvedValue(null);

      const result = await service.createWithVariants('user-1', 'store-1', {
        name: 'Cat Food',
        variants: [{ name: 'Flavour', values: ['Chicken', 'Fish'] }],
        variantItems: [
          { sku: 'CHK', stock: 10, price: 499, options: { Flavour: 'Chicken' } },
          { sku: 'FISH', stock: 5, price: 519, options: { Flavour: 'Fish' } },
        ],
      });

      expect(result.id).toBe('prod-1');
      // base price = cheapest variant item; adjustments preserve absolute prices
      const savedProduct = productRepository.save.mock.calls[0][0];
      expect(savedProduct.basePrice).toBe(499);
      // products from the public API are always forced to draft
      expect(savedProduct.status).toBe(ProductStatus.DRAFT);
      expect(variantRepository.save).toHaveBeenCalledTimes(2);
    });

    it('resolves category and tags by name on happy path', async () => {
      productRepository.findOne.mockImplementation(async ({ where }) => {
        if (where?.id) {
          return { id: 'prod-1', storeId: 'store-1', variants: [] };
        }
        return null;
      });
      variantRepository.findOne.mockResolvedValue(null);
      taxonomyService.getApprovedCategoryByName.mockResolvedValue({
        id: 'cat-1',
        name: 'Cat Food',
      });
      taxonomyService.getApprovedTagsByNames.mockResolvedValue([{ id: 'tag-1', name: 'organic' }]);
      taxonomyService.getApprovedCategory.mockResolvedValue({
        id: 'cat-1',
        name: 'Cat Food',
      });
      taxonomyService.getApprovedTags.mockResolvedValue([{ id: 'tag-1', name: 'organic' }]);

      await service.createWithVariants('user-1', 'store-1', {
        ...baseInput,
        category: 'Cat Food',
        tags: ['organic'],
      });

      expect(taxonomyService.getApprovedCategoryByName).toHaveBeenCalledWith('Cat Food');
      expect(taxonomyService.getApprovedTagsByNames).toHaveBeenCalledWith(['organic']);
      const savedProduct = productRepository.save.mock.calls[0][0];
      expect(savedProduct.categoryId).toBe('cat-1');
      expect(savedProduct.taxonomyTags).toEqual([{ id: 'tag-1', name: 'organic' }]);
    });

    it('persists variant items with sku, stock, and price adjustments', async () => {
      productRepository.findOne.mockImplementation(async ({ where }) => {
        if (where?.id) {
          return { id: 'prod-1', storeId: 'store-1', variants: [] };
        }
        return null;
      });
      variantRepository.findOne.mockResolvedValue(null);

      await service.createWithVariants('user-1', 'store-1', {
        name: 'Cat Food',
        variants: [{ name: 'Flavour', values: ['Chicken', 'Fish'] }],
        variantItems: [
          { sku: 'CHK', stock: 10, price: 499, options: { Flavour: 'Chicken' } },
          { sku: 'FISH', stock: 5, price: 519, options: { Flavour: 'Fish' } },
        ],
      });

      const savedVariants = variantRepository.save.mock.calls.map((call) => call[0]);
      expect(savedVariants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sku: 'CHK',
            stockQuantity: 10,
            priceAdjustment: 0,
            options: { Flavour: 'Chicken' },
          }),
          expect.objectContaining({
            sku: 'FISH',
            stockQuantity: 5,
            priceAdjustment: 20,
            options: { Flavour: 'Fish' },
          }),
        ]),
      );
    });
  });
});
