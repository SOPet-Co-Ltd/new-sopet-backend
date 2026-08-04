import { HttpException, Logger, Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { unwrapResolverError } from '@apollo/server/errors';
import type { GraphQLFormattedError } from 'graphql';
import { join } from 'node:path';
import {
  mapException,
  mapUnknownException,
  responseFromHttpException,
} from '../common/utils/exception-response.util';
import { AppGraphqlResolver } from './app.resolver';
import { AuthModule } from '../modules/auth/auth.module';
import { CartModule } from '../modules/cart/cart.module';
import { ProductsModule } from '../modules/products/products.module';
import { StoresModule } from '../modules/stores/stores.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { UsersModule } from '../modules/users/users.module';
import { PromotionsModule } from '../modules/promotions/promotions.module';
import { ReviewsModule } from '../modules/reviews/reviews.module';
import { PayoutsModule } from '../modules/payouts/payouts.module';
import { StorageModule } from '../modules/storage/storage.module';
import { AnalyticsModule } from '../modules/analytics/analytics.module';
import { PlatformModule } from '../modules/platform/platform.module';
import { AdminTeamModule } from '../modules/admin-team/admin-team.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { TaxonomyModule } from '../modules/taxonomy/taxonomy.module';
import { CustomersModule } from '../modules/customers/customers.module';
import { ApiKeysModule } from '../modules/api-keys/api-keys.module';
import { SearchModule } from '../modules/search/search.module';
import { AuditLogsModule } from '../modules/audit-logs/audit-logs.module';
import { GraphqlLoadersModule } from './loaders/graphql-loaders.module';
import { GraphqlContextFactory } from './loaders/graphql-context.factory';

const graphqlErrorLogger = new Logger('GraphQLFormatError');

@Module({
  imports: [
    GraphqlLoadersModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [GraphqlLoadersModule],
      inject: [GraphqlContextFactory],
      useFactory: (contextFactory: GraphqlContextFactory) => ({
        autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
        sortSchema: true,
        playground: process.env.NODE_ENV !== 'production',
        subscriptions: {
          'graphql-ws': true,
        },
        context: ({
          req,
          res,
          extra,
        }: {
          req: unknown;
          res: unknown;
          extra?: { request?: unknown };
        }) => contextFactory.create({ req: extra?.request ?? req, res }),
        formatError: (
          formattedError: GraphQLFormattedError,
          error: unknown,
        ): GraphQLFormattedError => {
          const originalError = unwrapResolverError(error);

          if (originalError instanceof HttpException) {
            const mapped = responseFromHttpException(originalError);
            return {
              ...formattedError,
              message: mapped.message,
              extensions: {
                ...formattedError.extensions,
                code: mapped.code,
                ...(mapped.details ? { details: mapped.details } : {}),
              },
            };
          }

          const mapped = mapUnknownException(originalError) ?? mapException(originalError);

          if (mapped.code === 'INTERNAL_SERVER_ERROR') {
            graphqlErrorLogger.error(
              originalError instanceof Error ? originalError.message : String(originalError),
              originalError instanceof Error ? originalError.stack : undefined,
            );
          }

          return {
            ...formattedError,
            message: mapped.message,
            extensions: {
              ...formattedError.extensions,
              code: mapped.code,
              ...(mapped.details ? { details: mapped.details } : {}),
            },
          };
        },
      }),
    }),
    AuthModule,
    CartModule,
    ProductsModule,
    StoresModule,
    OrdersModule,
    PaymentsModule,
    UsersModule,
    PromotionsModule,
    ReviewsModule,
    PayoutsModule,
    StorageModule,
    AnalyticsModule,
    PlatformModule,
    AdminTeamModule,
    NotificationsModule,
    TaxonomyModule,
    CustomersModule,
    ApiKeysModule,
    SearchModule,
    AuditLogsModule,
  ],
  providers: [AppGraphqlResolver],
})
export class AppGraphqlModule {}
