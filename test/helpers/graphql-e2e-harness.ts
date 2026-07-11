import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ProductsResolver } from '../../src/modules/products/products.resolver';
import { ProductsService } from '../../src/modules/products/products.service';
import { StoresService } from '../../src/modules/stores/stores.service';
import { TaxonomyResolver } from '../../src/modules/taxonomy/taxonomy.resolver';
import { TaxonomyService } from '../../src/modules/taxonomy/taxonomy.service';
import { AppGraphqlResolver } from '../../src/graphql/app.resolver';
import { GraphqlContextFactory } from '../../src/graphql/loaders/graphql-context.factory';
import { Product } from '../../src/database/entities/product.entity';
import { ProductVariant } from '../../src/database/entities/product-variant.entity';
import { ProductImage } from '../../src/database/entities/product-image.entity';
import { Store } from '../../src/database/entities/store.entity';
import { User } from '../../src/database/entities/user.entity';
import { StoreMember } from '../../src/database/entities/store-member.entity';
import { Category } from '../../src/database/entities/category.entity';
import { Tag } from '../../src/database/entities/tag.entity';
import { PetType } from '../../src/database/entities/pet-type.entity';
import { Brand } from '../../src/database/entities/brand.entity';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';
import { SearchAnalyticsService } from '../../src/modules/search/search-analytics.service';
import { OmiseService } from '../../src/modules/omise/omise.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { createTypeOrmTestOptions } from './typeorm-test.config';

export interface SearchTaxonomyGraphqlE2eHarness {
  app: INestApplication;
  moduleFixture: TestingModule;
}

/**
 * Boots Nest + GraphQL + real PostgreSQL for search-taxonomy integration suites.
 * Peripheral I/O (Redis, BullMQ, embedding, storage) stays mocked per design doc boundaries.
 */
export async function createSearchTaxonomyGraphqlE2eHarness(): Promise<SearchTaxonomyGraphqlE2eHarness> {
  const moduleFixture = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      TypeOrmModule.forRoot(createTypeOrmTestOptions()),
      TypeOrmModule.forFeature([
        Product,
        ProductVariant,
        ProductImage,
        Store,
        User,
        StoreMember,
        Category,
        Tag,
        PetType,
        Brand,
      ]),
      GraphQLModule.forRoot<ApolloDriverConfig>({
        driver: ApolloDriver,
        autoSchemaFile: true,
        context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
      }),
    ],
    providers: [
      AppGraphqlResolver,
      ProductsResolver,
      ProductsService,
      StoresService,
      TaxonomyResolver,
      TaxonomyService,
      GraphqlContextFactory,
      {
        provide: AnalyticsService,
        useValue: {
          getProductSoldCounts: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: SearchAnalyticsService,
        useValue: {
          recordSearchEvent: jest.fn(),
        },
      },
      {
        provide: OmiseService,
        useValue: {},
      },
      {
        provide: NotificationsService,
        useValue: {
          notifyTaxonomyProposal: jest.fn(),
          notifyStoreStatusChanged: jest.fn(),
        },
      },
      {
        provide: StorageService,
        useValue: {
          assertFolderImageUrl: jest.fn().mockResolvedValue(undefined),
        },
      },
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  await app.init();

  return { app, moduleFixture };
}

export async function closeSearchTaxonomyGraphqlE2eHarness(
  harness: SearchTaxonomyGraphqlE2eHarness | undefined,
): Promise<void> {
  if (harness?.app) {
    await harness.app.close();
  }
}
