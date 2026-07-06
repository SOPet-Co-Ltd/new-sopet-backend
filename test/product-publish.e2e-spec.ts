import { BadRequestException } from '@nestjs/common';
import { ProductsService } from '../src/modules/products/products.service';
import { ProductStatus } from '../src/database/entities/product.entity';

describe('Product publish (e2e)', () => {
  let service: ProductsService;
  let productRepository: {
    findOne: jest.Mock;
    save: jest.Mock;
  };
  let storesService: {
    userHasStoreAccess: jest.Mock;
  };

  const product = {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'Dog Food',
    slug: 'dog-food',
    status: ProductStatus.DRAFT,
    basePrice: 299,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    productRepository = {
      findOne: jest.fn(),
      save: jest.fn(async (data) => data),
    };
    storesService = {
      userHasStoreAccess: jest.fn(async () => true),
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
      storesService as never,
      {
        getApprovedCategory: jest.fn(),
        getApprovedTags: jest.fn(async () => []),
        getApprovedCategoryByName: jest.fn(),
        getApprovedTagsByNames: jest.fn(async () => []),
      } as never,
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

    await expect(service.publish('prod-1', 'user-1')).rejects.toMatchObject({
      response: {
        code: 'PRODUCT_NOT_PUBLISHABLE',
        details: {
          missingKeys: expect.arrayContaining(['name', 'media', 'category', 'variants']),
        },
      },
    });
    expect(productRepository.save).not.toHaveBeenCalled();
  });

  it('publishes product when checklist passes', async () => {
    productRepository.findOne.mockResolvedValue({
      ...product,
      categoryId: 'cat-1',
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
});
