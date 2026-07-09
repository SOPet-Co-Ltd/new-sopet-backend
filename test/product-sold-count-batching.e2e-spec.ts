import { GraphqlContextFactory } from '../src/graphql/loaders/graphql-context.factory';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';

describe('soldCount DataLoader batching (e2e)', () => {
  const productIds = Array.from({ length: 20 }, (_, index) => `product-${index + 1}`);
  const expectedCounts = productIds.map((_, index) => index + 1);

  it('coalesces N soldCount loads into one getProductSoldCounts call', async () => {
    const getProductSoldCounts = jest.fn().mockResolvedValue(expectedCounts);
    const analyticsService = { getProductSoldCounts } as unknown as AnalyticsService;
    const factory = new GraphqlContextFactory(analyticsService);
    const context = factory.create({ req: {}, res: {} });

    const results = await Promise.all(
      productIds.map((productId) => context.loaders.productSoldCount.load(productId)),
    );

    expect(getProductSoldCounts).toHaveBeenCalledTimes(1);
    expect(getProductSoldCounts).toHaveBeenCalledWith(productIds);
    expect(results).toEqual(expectedCounts);
  });

  it('returns zero for products missing from the aggregated batch result', async () => {
    const getProductSoldCounts = jest.fn().mockResolvedValue([5, 0, 12]);
    const analyticsService = { getProductSoldCounts } as unknown as AnalyticsService;
    const factory = new GraphqlContextFactory(analyticsService);
    const context = factory.create({ req: {}, res: {} });

    const results = await Promise.all([
      context.loaders.productSoldCount.load('p1'),
      context.loaders.productSoldCount.load('p2'),
      context.loaders.productSoldCount.load('p3'),
    ]);

    expect(getProductSoldCounts).toHaveBeenCalledTimes(1);
    expect(results).toEqual([5, 0, 12]);
  });

  it('isolates loaders between concurrent requests', async () => {
    const getProductSoldCounts = jest.fn().mockResolvedValueOnce([1, 2]).mockResolvedValueOnce([9]);

    const analyticsService = { getProductSoldCounts } as unknown as AnalyticsService;
    const factory = new GraphqlContextFactory(analyticsService);
    const firstContext = factory.create({ req: { id: 1 }, res: {} });
    const secondContext = factory.create({ req: { id: 2 }, res: {} });

    const [firstResults, secondResult] = await Promise.all([
      Promise.all([
        firstContext.loaders.productSoldCount.load('a'),
        firstContext.loaders.productSoldCount.load('b'),
      ]),
      secondContext.loaders.productSoldCount.load('z'),
    ]);

    expect(getProductSoldCounts).toHaveBeenCalledTimes(2);
    expect(firstResults).toEqual([1, 2]);
    expect(secondResult).toBe(9);
    expect(firstContext.loaders.productSoldCount).not.toBe(secondContext.loaders.productSoldCount);
  });
});
