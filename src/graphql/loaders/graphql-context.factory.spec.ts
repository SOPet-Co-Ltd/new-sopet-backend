import { Test, TestingModule } from '@nestjs/testing';
import { GraphqlContextFactory } from './graphql-context.factory';
import { AnalyticsService } from '../../modules/analytics/analytics.service';

describe('GraphqlContextFactory', () => {
  let factory: GraphqlContextFactory;

  const analyticsService = {
    getProductSoldCounts: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [GraphqlContextFactory, { provide: AnalyticsService, useValue: analyticsService }],
    }).compile();

    factory = module.get(GraphqlContextFactory);
  });

  it('returns req, res, and loaders on create', () => {
    const req = { id: 'req-1' };
    const res = { id: 'res-1' };

    const context = factory.create({ req, res });

    expect(context.req).toBe(req);
    expect(context.res).toBe(res);
    expect(context.loaders).toBeDefined();
    expect(context.loaders.productSoldCount).toBeDefined();
  });

  it('returns distinct loaders registries per create call', () => {
    const first = factory.create({ req: {}, res: {} });
    const second = factory.create({ req: {}, res: {} });

    expect(first.loaders).not.toBe(second.loaders);
    expect(first.loaders.productSoldCount).not.toBe(second.loaders.productSoldCount);
  });
});
