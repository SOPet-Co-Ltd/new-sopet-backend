import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductStatus } from '../../database/entities/product.entity';
import { VariantRemovalBlockReason } from './variant-removal.types';

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
  let orderItemRepository: {
    find: jest.Mock;
  };
  let cartItemRepository: {
    find: jest.Mock;
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
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ ...data, id: (data.id as string | undefined) ?? 'prod-1' }),
      ),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn(),
    };
    variantRepository = {
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve({ ...data, id: 'var-1' })),
      softDelete: jest.fn(),
    };
    imageRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findOneOrFail: jest.fn((opts: { where: { id: string } }) =>
        Promise.resolve({ id: opts.where.id }),
      ),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve({ ...data, id: 'img-1' })),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
    };
    orderItemRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    cartItemRepository = {
      find: jest.fn().mockResolvedValue([]),
    };
    storesService = {
      userHasStoreAccess: jest.fn((userId: string, storeId: string) =>
        Promise.resolve(userId === 'user-1' && storeId === 'store-1'),
      ),
      resolveDefaultStoreId: jest.fn(() => Promise.resolve('store-1')),
    };
    taxonomyService = {
      getApprovedCategory: jest.fn(),
      getApprovedTags: jest.fn(() => Promise.resolve([])),
      getApprovedCategoryByName: jest.fn(),
      getApprovedTagsByNames: jest.fn(() => Promise.resolve([])),
      resolveApprovedCategoryFilter: jest.fn(() => Promise.resolve(null)),
      resolveApprovedTagFilter: jest.fn(() => Promise.resolve(null)),
    };

    service = new ProductsService(
      productRepository as never,
      variantRepository as never,
      imageRepository as never,
      orderItemRepository as never,
      cartItemRepository as never,
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
    productRepository.save.mockImplementation((p: Record<string, unknown>) => p);

    const result = await service.update('prod-1', 'user-1', {
      name: 'Premium Dog Food',
    });

    expect(result.name).toBe('Premium Dog Food');
  });

  it('preserves status when update omits status (undefined)', async () => {
    productRepository.findOne.mockResolvedValue({ ...product, status: ProductStatus.DRAFT });
    productRepository.save.mockImplementation((p: Record<string, unknown>) => p);

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
    productRepository.save.mockImplementation((p: Record<string, unknown>) => p);

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
    productRepository.save.mockImplementation((p: Record<string, unknown>) => p);

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
    productRepository.save.mockImplementation((p: Record<string, unknown>) => p);

    const result = await service.publish('prod-1', 'user-1');
    expect(result.status).toBe(ProductStatus.PUBLISHED);
  });

  it('rejects duplicate SKU when adding variant', async () => {
    productRepository.findOne.mockResolvedValue(product);
    variantRepository.findOne.mockResolvedValue({ id: 'existing', sku: 'SKU-1' });

    await expect(
      service.addVariant('prod-1', 'user-1', {
        name: 'Default',
        sku: 'SKU-1',
        priceModifier: 100,
        stockQuantity: 5,
      }),
    ).rejects.toMatchObject({ response: { code: 'SKU_EXISTS' } });
  });

  it('adds variant to own product', async () => {
    productRepository.findOne.mockResolvedValue(product);
    variantRepository.findOne.mockResolvedValue(null);

    const variant = await service.addVariant('prod-1', 'user-1', {
      name: 'New Variant',
      sku: 'SKU-NEW',
      priceModifier: 150,
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
    variantRepository.save.mockImplementation((v: Record<string, unknown>) => v);

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

    await expect(service.updateVariant('var-1', 'user-1', { priceModifier: 120 })).rejects.toThrow(
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
      sku: 'SKU-1',
      product: { storeId: 'store-1' },
    });

    await service.removeVariant('var-1', 'user-1');

    expect(variantRepository.softDelete).toHaveBeenCalledWith('var-1');
  });

  describe('variant removal safety', () => {
    const keepVariant = {
      id: 'var-keep',
      sku: 'KEEP-1',
      stockQuantity: 5,
      priceAdjustment: 0,
      options: { Size: '1kg' },
    };
    const removeVariant = {
      id: 'var-remove',
      sku: 'REMOVE-1',
      stockQuantity: 3,
      priceAdjustment: 0,
      options: { Size: '2kg' },
    };
    const productWithVariants = {
      ...product,
      basePrice: 100,
      variants: [keepVariant, removeVariant],
    };

    const keepOnlyPayload = [
      {
        id: keepVariant.id,
        sku: keepVariant.sku,
        stockQuantity: 5,
        attributes: { Size: '1kg' },
      },
    ];

    beforeEach(() => {
      productRepository.findOne.mockResolvedValue(productWithVariants);
      variantRepository.save.mockImplementation((data) => Promise.resolve(data));
    });

    it('soft-deletes unreferenced sync removals', async () => {
      await service.syncVariants('prod-1', 'user-1', keepOnlyPayload);

      expect(variantRepository.softDelete).toHaveBeenCalledWith('var-remove');
      expect(variantRepository.softDelete).toHaveBeenCalledTimes(1);
    });

    it('blocks syncVariants when removal has order_items only', async () => {
      orderItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.syncVariants('prod-1', 'user-1', keepOnlyPayload)).rejects.toMatchObject(
        {
          response: {
            code: 'VARIANT_REMOVAL_BLOCKED',
            blockedVariants: [
              {
                id: 'var-remove',
                sku: 'REMOVE-1',
                reasons: [VariantRemovalBlockReason.HAS_ORDERS],
              },
            ],
          },
        },
      );
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('blocks syncVariants when removal has cart_items only', async () => {
      cartItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.syncVariants('prod-1', 'user-1', keepOnlyPayload)).rejects.toMatchObject(
        {
          response: {
            code: 'VARIANT_REMOVAL_BLOCKED',
            blockedVariants: [
              {
                id: 'var-remove',
                sku: 'REMOVE-1',
                reasons: [VariantRemovalBlockReason.HAS_OPEN_CARTS],
              },
            ],
          },
        },
      );
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('blocks syncVariants when removal has orders and carts', async () => {
      orderItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);
      cartItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.syncVariants('prod-1', 'user-1', keepOnlyPayload)).rejects.toMatchObject(
        {
          response: {
            code: 'VARIANT_REMOVAL_BLOCKED',
            blockedVariants: [
              {
                id: 'var-remove',
                sku: 'REMOVE-1',
                reasons: [
                  VariantRemovalBlockReason.HAS_ORDERS,
                  VariantRemovalBlockReason.HAS_OPEN_CARTS,
                ],
              },
            ],
          },
        },
      );
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes unreferenced removeVariant', async () => {
      variantRepository.findOne.mockResolvedValue({
        ...removeVariant,
        product: { storeId: 'store-1' },
      });

      await service.removeVariant('var-remove', 'user-1');

      expect(variantRepository.softDelete).toHaveBeenCalledWith('var-remove');
    });

    it('blocks removeVariant when variant has order_items only', async () => {
      variantRepository.findOne.mockResolvedValue({
        ...removeVariant,
        product: { storeId: 'store-1' },
      });
      orderItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.removeVariant('var-remove', 'user-1')).rejects.toMatchObject({
        response: {
          code: 'VARIANT_REMOVAL_BLOCKED',
          blockedVariants: [
            expect.objectContaining({
              id: 'var-remove',
              reasons: [VariantRemovalBlockReason.HAS_ORDERS],
            }),
          ],
        },
      });
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('blocks removeVariant when variant has cart_items only', async () => {
      variantRepository.findOne.mockResolvedValue({
        ...removeVariant,
        product: { storeId: 'store-1' },
      });
      cartItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.removeVariant('var-remove', 'user-1')).rejects.toMatchObject({
        response: {
          code: 'VARIANT_REMOVAL_BLOCKED',
          blockedVariants: [
            expect.objectContaining({
              id: 'var-remove',
              reasons: [VariantRemovalBlockReason.HAS_OPEN_CARTS],
            }),
          ],
        },
      });
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it('blocks removeVariant when variant has orders and carts', async () => {
      variantRepository.findOne.mockResolvedValue({
        ...removeVariant,
        product: { storeId: 'store-1' },
      });
      orderItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);
      cartItemRepository.find.mockResolvedValue([{ variantId: 'var-remove' }]);

      await expect(service.removeVariant('var-remove', 'user-1')).rejects.toMatchObject({
        response: {
          code: 'VARIANT_REMOVAL_BLOCKED',
          blockedVariants: [
            expect.objectContaining({
              id: 'var-remove',
              reasons: [
                VariantRemovalBlockReason.HAS_ORDERS,
                VariantRemovalBlockReason.HAS_OPEN_CARTS,
              ],
            }),
          ],
        },
      });
      expect(variantRepository.softDelete).not.toHaveBeenCalled();
    });

    it.each([
      {
        label: 'unreferenced',
        orderRefs: [] as Array<{ variantId: string }>,
        cartRefs: [] as Array<{ variantId: string }>,
        expectBlocked: false,
      },
      {
        label: 'orders-only',
        orderRefs: [{ variantId: 'var-remove' }],
        cartRefs: [],
        expectBlocked: true,
      },
      {
        label: 'carts-only',
        orderRefs: [],
        cartRefs: [{ variantId: 'var-remove' }],
        expectBlocked: true,
      },
      {
        label: 'both',
        orderRefs: [{ variantId: 'var-remove' }],
        cartRefs: [{ variantId: 'var-remove' }],
        expectBlocked: true,
      },
    ])(
      'impact.blocked agrees with sync reject for $label fixtures',
      async ({ orderRefs, cartRefs, expectBlocked }) => {
        orderItemRepository.find.mockResolvedValue(orderRefs);
        cartItemRepository.find.mockResolvedValue(cartRefs);

        const impact = await service.getProductVariantSyncImpact(
          'prod-1',
          'user-1',
          keepOnlyPayload,
        );

        expect(impact.blocked).toBe(expectBlocked);
        expect(impact.kept).toBe(1);
        expect(impact.new).toBe(0);
        expect(impact.removed).toBe(1);
        expect(impact.removedVariants[0]).toEqual(
          expect.objectContaining({
            id: 'var-remove',
            sku: 'REMOVE-1',
            optionKey: 'Size:2kg',
          }),
        );

        if (expectBlocked) {
          await expect(
            service.syncVariants('prod-1', 'user-1', keepOnlyPayload),
          ).rejects.toMatchObject({
            response: { code: 'VARIANT_REMOVAL_BLOCKED' },
          });
          expect(variantRepository.softDelete).not.toHaveBeenCalled();
        } else {
          await service.syncVariants('prod-1', 'user-1', keepOnlyPayload);
          expect(variantRepository.softDelete).toHaveBeenCalledWith('var-remove');
        }
      },
    );

    it('returns AC-001 style counts for keep/new/unreferenced remove', async () => {
      const newItem = {
        sku: 'NEW-1',
        stockQuantity: 2,
        attributes: { Size: '5kg' },
      };
      const keepA = {
        id: 'var-a',
        sku: 'A',
        stockQuantity: 1,
        priceAdjustment: 0,
        options: { Size: 'S' },
      };
      const keepB = {
        id: 'var-b',
        sku: 'B',
        stockQuantity: 1,
        priceAdjustment: 0,
        options: { Size: 'M' },
      };
      const keepC = {
        id: 'var-c',
        sku: 'C',
        stockQuantity: 1,
        priceAdjustment: 0,
        options: { Size: 'L' },
      };
      const removeUnreferenced = {
        id: 'var-old',
        sku: 'OLD',
        stockQuantity: 1,
        priceAdjustment: 0,
        options: { Size: 'XL' },
      };

      productRepository.findOne.mockResolvedValue({
        ...product,
        variants: [keepA, keepB, keepC, removeUnreferenced],
      });

      const impact = await service.getProductVariantSyncImpact('prod-1', 'user-1', [
        { id: keepA.id, sku: keepA.sku, stockQuantity: 1, attributes: { Size: 'S' } },
        { id: keepB.id, sku: keepB.sku, stockQuantity: 1, attributes: { Size: 'M' } },
        { id: keepC.id, sku: keepC.sku, stockQuantity: 1, attributes: { Size: 'L' } },
        newItem,
        {
          sku: 'NEW-2',
          stockQuantity: 2,
          attributes: { Size: 'XXL' },
        },
      ]);

      expect(impact).toEqual(
        expect.objectContaining({
          kept: 3,
          new: 2,
          removed: 1,
          blocked: false,
        }),
      );
      expect(impact.removedVariants).toEqual([
        expect.objectContaining({
          id: 'var-old',
          sku: 'OLD',
          reasons: [],
        }),
      ]);
    });
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
      productRepository.findOne.mockImplementation((opts: { where?: { id?: string } }) => {
        if (opts.where?.id) {
          return Promise.resolve({ id: 'prod-1', storeId: 'store-1', variants: [] });
        }
        return Promise.resolve(null);
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
      const savedProductCall = productRepository.save.mock.calls[0] as
        [Record<string, unknown>] | undefined;
      const savedProduct = savedProductCall?.[0] as {
        basePrice: number;
        status: ProductStatus;
      };
      expect(savedProduct.basePrice).toBe(499);
      // products from the public API are always forced to draft
      expect(savedProduct.status).toBe(ProductStatus.DRAFT);
      expect(variantRepository.save).toHaveBeenCalledTimes(2);
    });

    it('resolves category and tags by name on happy path', async () => {
      productRepository.findOne.mockImplementation((opts: { where?: { id?: string } }) => {
        if (opts.where?.id) {
          return Promise.resolve({ id: 'prod-1', storeId: 'store-1', variants: [] });
        }
        return Promise.resolve(null);
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
      const savedProductCall = productRepository.save.mock.calls[0] as
        [Record<string, unknown>] | undefined;
      const savedProduct = savedProductCall?.[0] as {
        categoryId: string;
        taxonomyTags: Array<{ id: string; name: string }>;
      };
      expect(savedProduct.categoryId).toBe('cat-1');
      expect(savedProduct.taxonomyTags).toEqual([{ id: 'tag-1', name: 'organic' }]);
    });

    it('persists variant items with sku, stock, and price adjustments', async () => {
      productRepository.findOne.mockImplementation((opts: { where?: { id?: string } }) => {
        if (opts.where?.id) {
          return Promise.resolve({ id: 'prod-1', storeId: 'store-1', variants: [] });
        }
        return Promise.resolve(null);
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

      const savedVariants = (
        variantRepository.save.mock.calls as Array<[Record<string, unknown>]>
      ).map((call) => call[0]);
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
