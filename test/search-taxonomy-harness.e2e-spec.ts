// Search & Taxonomy Fixes — PostgreSQL harness smoke (task-01)
// Verifies Nest TestingModule + GraphQL supertest + seeded PostgreSQL for downstream
// `search-taxonomy-listing-parity` and `search-taxonomy-rejected` promotion.
//
// Promotion targets:
//   test/search-taxonomy-listing-parity.int.test.ts → search-taxonomy-listing-parity.e2e-spec.ts
//   test/search-taxonomy-rejected.int.test.ts       → search-taxonomy-rejected.e2e-spec.ts

import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { ProductStatus } from '../src/database/entities/product.entity';
import { StoreStatus } from '../src/database/entities/store.entity';
import {
  cleanupSeedRun,
  closeSearchTaxonomyGraphqlE2eHarness,
  createSearchTaxonomyGraphqlE2eHarness,
  createSeedRunContext,
  isPostgresAvailable,
  seedListingParityDataset,
  seedRejectedTaxonomyDataset,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';
import type { SearchTaxonomyGraphqlE2eHarness } from './helpers/graphql-e2e-harness';

const HEALTH_QUERY = `{ health { status api } }`;
const PRODUCTS_QUERY = `
  query HarnessProducts($limit: Int) {
    products(limit: $limit) {
      items { id name }
      pagination { total }
    }
  }
`;

interface HealthQueryBody {
  data: { health: { status: string; api: string } };
}

interface ProductsQueryBody {
  data: {
    products: {
      items: Array<{ id: string; name: string }>;
      pagination: { total: number };
    };
  };
  errors?: unknown;
}

describe('Search taxonomy PostgreSQL harness (e2e)', () => {
  let postgresAvailable = false;
  let dataSource: DataSource;
  let harness: SearchTaxonomyGraphqlE2eHarness | undefined;
  const seedContext = createSeedRunContext(`stx-harness-${Date.now()}`);

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    dataSource = new DataSource(createTypeOrmTestOptions());
    await dataSource.initialize();
    harness = await createSearchTaxonomyGraphqlE2eHarness();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupSeedRun(dataSource, seedContext);
      await dataSource.destroy();
    }

    await closeSearchTaxonomyGraphqlE2eHarness(harness);
  });

  const itWhenPostgres = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!postgresAvailable) {
        console.warn('Skipping: PostgreSQL not available for search-taxonomy harness smoke');
        return;
      }

      await fn();
    });
  };

  itWhenPostgres('boots GraphQL health query via supertest POST /graphql', async () => {
    const res = await request(harness!.app.getHttpServer() as App)
      .post('/graphql')
      .send({ query: HEALTH_QUERY })
      .expect(200);

    const body = res.body as HealthQueryBody;
    expect(body.data.health.status).toBe('ok');
    expect(body.data.health.api).toBe('graphql');
  });

  itWhenPostgres(
    'seeds listing-parity + rejected taxonomy rows and products query succeeds',
    async () => {
      const listing = await seedListingParityDataset(dataSource, seedContext);
      const rejected = await seedRejectedTaxonomyDataset(dataSource, seedContext);

      expect(listing.publishedApprovedProduct.status).toBe(ProductStatus.PUBLISHED);
      expect(listing.suspendedStore.status).toBe(StoreStatus.SUSPENDED);
      expect(rejected.rejectedCategories).toHaveLength(2);
      expect(rejected.rejectedTags).toHaveLength(2);

      const res = await request(harness!.app.getHttpServer() as App)
        .post('/graphql')
        .send({
          query: PRODUCTS_QUERY,
          variables: { limit: 100 },
        })
        .expect(200);

      const body = res.body as ProductsQueryBody;
      expect(body.errors).toBeUndefined();
      expect(body.data.products.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: listing.publishedApprovedProduct.id }),
        ]),
      );
      expect(body.data.products.pagination.total).toBeGreaterThanOrEqual(1);
    },
  );
});
