import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '../../modules/analytics/analytics.service';
import type { GraphqlContext, GraphqlLoaders } from './graphql-context.types';
import { createProductSoldCountLoader } from './product-sold-count.loader';

@Injectable()
export class GraphqlContextFactory {
  constructor(private readonly analyticsService: AnalyticsService) {}

  create({ req, res }: { req: unknown; res: unknown }): GraphqlContext {
    const loaders: GraphqlLoaders = {
      productSoldCount: createProductSoldCountLoader(this.analyticsService),
    };

    return { req, res, loaders };
  }
}
