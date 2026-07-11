// Search & Taxonomy Fixes — Listing Parity (AC-001–AC-004)
// Promoted from search-taxonomy-listing-parity.int.test.ts (backend-task-02)

import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { TaxonomyApprovalStatus } from '../src/database/entities/enums/taxonomy.enums';
import { Product } from '../src/database/entities/product.entity';
import {
  cleanupSeedRun,
  closeSearchTaxonomyGraphqlE2eHarness,
  createSearchTaxonomyGraphqlE2eHarness,
  createSeedRunContext,
  createTestProduct,
  createTestTag,
  isPostgresAvailable,
  seedListingParityDataset,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';
import type { SearchTaxonomyGraphqlE2eHarness } from './helpers/graphql-e2e-harness';
import type { ListingParitySeedDataset } from './helpers/seed-factories';

const PRODUCTS_QUERY = `
  query ListingParityProducts($category: String, $tag: String, $limit: Int) {
    products(category: $category, tag: $tag, limit: $limit) {
      items { id name }
      pagination { total }
    }
  }
`;

const PRODUCTS_ARGS_INTROSPECTION = `
  {
    __type(name: "Query") {
      fields {
        name
        args {
          name
        }
      }
    }
  }
`;

describe('Search taxonomy listing parity (e2e)', () => {
  let postgresAvailable = false;
  let dataSource: DataSource;
  let harness: SearchTaxonomyGraphqlE2eHarness | undefined;
  const seedContext = createSeedRunContext(`stx-listing-parity-${Date.now()}`);
  let seed: ListingParitySeedDataset;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    dataSource = new DataSource(createTypeOrmTestOptions());
    await dataSource.initialize();
    harness = await createSearchTaxonomyGraphqlE2eHarness();
    seed = await seedListingParityDataset(dataSource, seedContext);
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
        console.warn('Skipping: PostgreSQL not available for listing-parity e2e');
        return;
      }

      await fn();
    });
  };

  const queryProducts = async (variables?: { category?: string; tag?: string; limit?: number }) => {
    return request(harness!.app.getHttpServer() as App)
      .post('/graphql')
      .send({
        query: PRODUCTS_QUERY,
        variables: { limit: 100, ...variables },
      })
      .expect(200);
  };

  itWhenPostgres(
    'AC-001: legacy listing returns only PUBLISHED products from approved stores',
    async () => {
      const res = await queryProducts({ category: seed.approvedCategory.slug });
      expect(res.body.errors).toBeUndefined();

      const ids = res.body.data.products.items.map((item: { id: string }) => item.id);

      expect(ids).toContain(seed.publishedApprovedProduct.id);
      expect(ids).not.toContain(seed.publishedSuspendedProduct.id);
      expect(ids).not.toContain(seed.draftApprovedProduct.id);
      expect(res.body.data.products.pagination.total).toBe(1);
    },
  );

  itWhenPostgres(
    'AC-003: category slug filters by FK despite stale legacy category string',
    async () => {
      const res = await queryProducts({ category: seed.approvedCategory.slug });
      expect(res.body.errors).toBeUndefined();

      const ids = res.body.data.products.items.map((item: { id: string }) => item.id);

      expect(ids).toEqual([seed.publishedApprovedProduct.id]);
      expect(res.body.data.products.pagination.total).toBe(1);
    },
  );

  itWhenPostgres('AC-003: unresolvable category slug yields empty listing', async () => {
    const res = await queryProducts({ category: 'nonexistent-slug' });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.products.items).toEqual([]);
    expect(res.body.data.products.pagination.total).toBe(0);
  });

  itWhenPostgres('failure mode: unknown tag UUID yields empty listing', async () => {
    const res = await queryProducts({
      tag: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.products.items).toEqual([]);
    expect(res.body.data.products.pagination.total).toBe(0);
  });

  itWhenPostgres('tag UUID filter returns only tag-linked products', async () => {
    const adminId = seedContext.userIds[0];
    const approvedTag = await createTestTag(dataSource, seedContext, {
      suffix: 'parity-tag',
      createdBy: adminId,
      approvalStatus: TaxonomyApprovalStatus.APPROVED,
    });

    const taggedProduct = await createTestProduct(dataSource, seedContext, {
      suffix: 'tagged-product',
      storeId: seed.approvedStore.id,
      status: seed.publishedApprovedProduct.status,
      categoryId: seed.approvedCategory.id,
    });

    const productRepo = dataSource.getRepository(Product);
    taggedProduct.taxonomyTags = [approvedTag];
    await productRepo.save(taggedProduct);

    const res = await queryProducts({ tag: approvedTag.id });
    expect(res.body.errors).toBeUndefined();

    const ids = res.body.data.products.items.map((item: { id: string }) => item.id);

    expect(ids).toEqual([taggedProduct.id]);
    expect(res.body.data.products.pagination.total).toBe(1);
  });

  itWhenPostgres(
    'AC-004: products query exposes category String only (no public categoryId)',
    async () => {
      const res = await request(harness!.app.getHttpServer() as App)
        .post('/graphql')
        .send({ query: PRODUCTS_ARGS_INTROSPECTION })
        .expect(200);

      expect(res.body.errors).toBeUndefined();

      const productsField = res.body.data.__type.fields.find(
        (field: { name: string }) => field.name === 'products',
      );
      const argNames = productsField.args.map((arg: { name: string }) => arg.name);

      expect(argNames).toContain('category');
      expect(argNames).not.toContain('categoryId');
      expect(argNames).not.toContain('tagId');
    },
  );
});
