import { Test, TestingModule } from '@nestjs/testing';
import { ProductsResolver } from './products.resolver';
import { ProductsService } from './products.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { PersonalizationService } from '../search/personalization.service';
import { SearchAnalyticsService } from '../search/search-analytics.service';
import { SearchRepository } from '../search/search.repository';
import { SearchSettingsService } from '../search/search-settings.service';
import { ProductStatus } from '../../database/entities/product.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';
import type { ProductType } from '../../graphql/models/types';

describe('ProductsResolver', () => {
  let resolver: ProductsResolver;

  const productsService = {
    findAll: jest.fn(),
    findPublishedByIds: jest.fn(),
    resolveActiveStoreId: jest.fn(),
  };
  const analyticsService = {
    getPlatformTopProducts: jest.fn(),
  };
  const searchAnalyticsService = {
    recordSearchEvent: jest.fn(),
  };
  const searchRepository = {
    fetchProductPersonalizationMeta: jest.fn(),
  };
  const personalizationService = {
    buildProfile: jest.fn(),
    reorderIds: jest.fn(),
  };
  const searchSettingsService = {
    getRankingWeights: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsResolver,
        { provide: ProductsService, useValue: productsService },
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: SearchAnalyticsService, useValue: searchAnalyticsService },
        { provide: SearchRepository, useValue: searchRepository },
        { provide: PersonalizationService, useValue: personalizationService },
        { provide: SearchSettingsService, useValue: searchSettingsService },
      ],
    }).compile();

    resolver = module.get(ProductsResolver);
  });

  describe('soldCount', () => {
    it('loads sold count via context loader instead of analytics service', async () => {
      const load = jest.fn().mockResolvedValue(42);
      const context = {
        req: {},
        res: {},
        loaders: {
          productSoldCount: { load },
        },
      } as unknown as GraphqlContext;
      const product = { id: 'product-1' } as ProductType;

      const result = await resolver.soldCount(product, context);

      expect(load).toHaveBeenCalledWith('product-1');
      expect(result).toBe(42);
    });
  });

  describe('products limit cap', () => {
    beforeEach(() => {
      productsService.findAll.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('clamps an excessive limit to 100', async () => {
      await resolver.products(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        10_000,
      );

      expect(productsService.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('clamps zero limit to 1', async () => {
      await resolver.products(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        0,
      );

      expect(productsService.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('defaults omitted limit to 20', async () => {
      await resolver.products();

      expect(productsService.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    });
  });

  describe('vendorProducts filter pass-through', () => {
    beforeEach(() => {
      productsService.resolveActiveStoreId = jest.fn().mockResolvedValue('store-1');
      productsService.findAll.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('forwards petTypeIds, brandIds, tag, minPrice, and maxPrice to findAll', async () => {
      await resolver.vendorProducts(
        'user-1',
        'store-1',
        'treats',
        'cat-food',
        'organic',
        ['pet-1'],
        ['brand-1'],
        100,
        500,
        2,
        50,
      );

      expect(productsService.findAll).toHaveBeenCalledWith({
        search: 'treats',
        storeId: 'store-1',
        category: 'cat-food',
        tag: 'organic',
        petTypeIds: ['pet-1'],
        brandIds: ['brand-1'],
        minPrice: 100,
        maxPrice: 500,
        allStatuses: true,
        page: 2,
        limit: 50,
      });
    });
  });

  describe('recommendedProducts', () => {
    const productA = { id: 'product-a', name: 'Product A' };
    const productB = { id: 'product-b', name: 'Product B' };
    const productC = { id: 'product-c', name: 'Product C' };

    beforeEach(() => {
      analyticsService.getPlatformTopProducts.mockResolvedValue([
        { productId: 'product-a' },
        { productId: 'product-b' },
        { productId: 'product-c' },
      ]);
      productsService.findPublishedByIds.mockResolvedValue([productA, productB, productC]);
      productsService.findAll.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      });
      searchRepository.fetchProductPersonalizationMeta.mockResolvedValue([]);
      personalizationService.buildProfile.mockResolvedValue({
        petTypeIds: [],
        brandIds: [],
        categoryIds: [],
        queryTokens: [],
      });
      searchSettingsService.getRankingWeights.mockResolvedValue({ personalizationCap: 0.1 });
      personalizationService.reorderIds.mockImplementation((ids: string[]) => ids);
    });

    it('excludes requested product ids and shuffles deterministically by seed', async () => {
      const firstResult = await resolver.recommendedProducts(
        4,
        undefined,
        undefined,
        ['product-a'],
        'seed-a',
      );
      const secondResult = await resolver.recommendedProducts(
        4,
        undefined,
        undefined,
        ['product-a'],
        'seed-a',
      );

      expect(firstResult.map((product) => product.id)).toEqual(
        secondResult.map((product) => product.id),
      );
      expect(firstResult.every((product) => product.id !== 'product-a')).toBe(true);
      expect(firstResult).toHaveLength(2);
    });

    it('backfills with latest published products when top products are sparse', async () => {
      analyticsService.getPlatformTopProducts.mockResolvedValue([{ productId: 'product-a' }]);
      productsService.findPublishedByIds.mockResolvedValue([productA]);
      productsService.findAll.mockResolvedValue({
        items: [productB, productC],
        pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
      });

      const result = await resolver.recommendedProducts(
        3,
        undefined,
        undefined,
        undefined,
        'seed-a',
      );

      expect(productsService.findAll).toHaveBeenCalledWith({
        status: ProductStatus.PUBLISHED,
        page: 1,
        limit: 9,
      });
      expect(result).toHaveLength(3);
    });
  });

  describe('vendorProducts limit cap', () => {
    beforeEach(() => {
      productsService.resolveActiveStoreId = jest.fn().mockResolvedValue('store-1');
      productsService.findAll.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('clamps an excessive limit to 100', async () => {
      await resolver.vendorProducts(
        'user-1',
        'store-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        10_000,
      );

      expect(productsService.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
  });
});
