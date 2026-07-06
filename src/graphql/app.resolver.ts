import { Query, Resolver } from '@nestjs/graphql';
import { Public } from '../common/decorators/public.decorator';
import { HealthStatus } from './models/health-status.model';

@Resolver()
export class AppGraphqlResolver {
  @Public()
  @Query(() => HealthStatus, { description: 'GraphQL API health check' })
  health(): HealthStatus {
    return {
      status: 'ok',
      api: 'graphql',
      timestamp: new Date().toISOString(),
    };
  }
}
