import { BadRequestException } from '@nestjs/common';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductStatus } from '../src/database/entities/product.entity';

describe('Product publish (e2e)', () => {
  let service: ProductsService;
  let productRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let storesService: {
    userHasStoreAccess: jest.Mock;
    isStoreSuspended: jest.Mock;
  };
  let shippingOptionsService: {
    hasShippingOptions: jest.Mock;
  };

  const product = {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'Dog Food',
    slug: 'dog-food',
    status: ProductStatus.DRAFT,
    basePrice: 299,
  };

  function mockPublishManyQueryBuilders(publishableIds: string[]) {
    const checklistQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(publishableIds.map((id) => ({ id }))),
    };
    const execute = jest.fn().mockResolvedValue({ affected: publishableIds.length });
    const where = jest.fn().mockReturnValue({ execute });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const updateQb = { update };

    productRepository.createQueryBuilder.mockImplementation((alias?: string) => {
      if (alias === 'product') {
        return checklistQb;
      }
      return updateQb;
    });

    return { checklistQb, update, set, where, execute };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    productRepository = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((data: Record<string, unknown>) => Promise.resolve(data)),
      createQueryBuilder: jest.fn(),
    };
    storesService = {
      userHasStoreAccess: jest.fn(() => Promise.resolve(true)),
      isStoreSuspended: jest.fn(() => Promise.resolve(false)),
    };
    shippingOptionsService = {
      hasShippingOptions: jest.fn().mockResolvedValue(true),
    };

    service = new ProductsService(
      productRepository as never,
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), softDelete: jest.fn() } as never,
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        save: jest.fn(),
        softDelete: jest.fn(),
        createQueryBuilder: jest.fn(),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      storesService as never,
      {
        getApprovedCategory: jest.fn(),
        getApprovedTags: jest.fn(() => Promise.resolve([])),
        getApprovedCategoryByName: jest.fn(),
        getApprovedTagsByNames: jest.fn(() => Promise.resolve([])),
      } as never,
      shippingOptionsService as never,
      { importImageFromUrl: jest.fn() } as never,
    );
  });

  it('rejects publish when product checklist is incomplete', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      name: '',
      images: [],
      variants: [],
      categoryId: null,
      basePrice: 0,
    });

    try {
      await service.publish('prod-1', 'user-1');
      throw new Error('expected publish to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        code: string;
        details: { missingKeys: string[] };
      };
      expect(response.code).toBe('PRODUCT_NOT_PUBLISHABLE');
      expect(response.details.missingKeys).toEqual(
        expect.arrayContaining(['name', 'media', 'category', 'variants']),
      );
    }
    expect(productRepository.save).not.toHaveBeenCalled();
  });

  it('publishes product when checklist passes', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      categoryId: 'cat-1',
      petTypeId: 'pet-1',
      images: [{ id: 'img-1', url: 'https://example.com/a.jpg' }],
      variants: [{ id: 'var-1', sku: 'SKU-1', stockQuantity: 10, priceAdjustment: 0 }],
    });

    const result = await service.publish('prod-1', 'user-1');

    expect(result.status).toBe(ProductStatus.PUBLISHED);
    expect(productRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ProductStatus.PUBLISHED }),
    );
  });

  it('rejects publish with BadRequestException for incomplete product', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      images: [],
      variants: [],
      categoryId: null,
    });

    await expect(service.publish('prod-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('batch-publishes eligible products and reports failures for incomplete ones', async () => {
    const incomplete = {
      ...product,
      id: 'prod-2',
      name: '',
      images: [],
      variants: [],
      categoryId: null,
      petTypeId: null,
      basePrice: 0,
    };
    productRepository.find = jest
      .fn()
      .mockResolvedValueOnce([
        {
          ...product,
          id: 'prod-1',
          categoryId: 'cat-1',
          petTypeId: 'pet-1',
          images: [{ id: 'img-1', url: 'https://example.com/a.jpg' }],
          variants: [{ id: 'var-1', sku: 'SKU-1', stockQuantity: 10, priceAdjustment: 0 }],
        },
        incomplete,
      ])
      .mockResolvedValueOnce([incomplete]);
    const qb = mockPublishManyQueryBuilders(['prod-1']);

    const result = await service.publishMany(['prod-1', 'prod-2'], 'user-1');

    expect(result.publishedIds).toEqual(['prod-1']);
    expect(result.failures).toEqual([
      expect.objectContaining({
        productId: 'prod-2',
        code: 'PRODUCT_NOT_PUBLISHABLE',
      }),
    ]);
    expect(productRepository.save).not.toHaveBeenCalled();
    expect(qb.update).toHaveBeenCalled();
    expect(qb.where).toHaveBeenCalledWith('id IN (:...ids)', { ids: ['prod-1'] });
  });
});
