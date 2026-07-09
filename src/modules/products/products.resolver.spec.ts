import { Test, TestingModule } from '@nestjs/testing';
import { ProductsResolver } from './products.resolver';
import { ProductsService } from './products.service';
import { AnalyticsService } from '../analytics/analytics.service';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';
import type { ProductType } from '../../graphql/models/types';

describe('ProductsResolver', () => {
  let resolver: ProductsResolver;

  const productsService = {
    findAll: jest.fn(),
  };
  const analyticsService = {
    getPlatformTopProducts: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsResolver,
        { provide: ProductsService, useValue: productsService },
        { provide: AnalyticsService, useValue: analyticsService },
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

  describe('vendorProducts limit cap', () => {
    beforeEach(() => {
      productsService.resolveActiveStoreId = jest.fn().mockResolvedValue('store-1');
      productsService.findAll.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('clamps an excessive limit to 100', async () => {
      await resolver.vendorProducts('user-1', 'store-1', undefined, undefined, 1, 10_000);

      expect(productsService.findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
  });
});
