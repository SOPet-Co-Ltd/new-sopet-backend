import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../../modules/analytics/analytics.module';
import { GraphqlContextFactory } from './graphql-context.factory';

@Module({
  imports: [AnalyticsModule],
  providers: [GraphqlContextFactory],
  exports: [GraphqlContextFactory],
})
export class GraphqlLoadersModule {}
