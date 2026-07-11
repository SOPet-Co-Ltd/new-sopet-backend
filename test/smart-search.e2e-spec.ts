// Smart Search — Search & Taxonomy Fixes AC-006 (semantic leg tag filter)
// Promoted from test/smart-search.int.test.ts (backend-task-03)

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { TaxonomyApprovalStatus } from '../src/database/entities/enums/taxonomy.enums';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { ProductEmbedding } from '../src/database/entities/product-embedding.entity';
import { RankingEngine } from '../src/modules/search/ranking.engine';
import { SearchRepository } from '../src/modules/search/search.repository';
import { VectorSearchSupport } from '../src/modules/search/vector-search.support';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestTag,
  isPostgresAvailable,
  seedListingParityDataset,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

const EMBEDDING_DIMENSION = 1536;

function buildEmbedding(primary: number, secondary = 0): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  vector[0] = primary;
  if (EMBEDDING_DIMENSION > 1) {
    vector[1] = secondary;
  }
  return vector;
}

async function ensureVectorExtension(dataSource: DataSource): Promise<boolean> {
  const availability: Array<{ vector_available: boolean }> = await dataSource.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
    ) AS vector_available
  `);
  if (availability[0]?.vector_available !== true) {
    return false;
  }

  await dataSource.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await dataSource.query(`
    CREATE TABLE IF NOT EXISTS product_embeddings (
      product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      embedding vector(1536) NOT NULL,
      model_version varchar(64) NOT NULL,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  return true;
}

async function upsertProductEmbedding(
  dataSource: DataSource,
  productId: string,
  embedding: number[],
): Promise<void> {
  const literal = `[${embedding.join(',')}]`;
  await dataSource.query(
    `
    INSERT INTO product_embeddings (product_id, embedding, model_version, updated_at)
    VALUES ($1, $2::vector, 'e2e-test', now())
    ON CONFLICT (product_id) DO UPDATE
      SET embedding = EXCLUDED.embedding, model_version = EXCLUDED.model_version, updated_at = now()
  `,
    [productId, literal],
  );
}

describe('SearchRepository semantic tag predicate SQL', () => {
  it('fetchSemanticLegIds appends shared tag EXISTS clause with t.id', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const vectorSupport = { isAvailable: jest.fn().mockResolvedValue(true) };
    const repository = new SearchRepository(
      {} as Repository<Product>,
      {} as RankingEngine,
      vectorSupport as never,
      { query } as never,
    );

    const tagId = '11111111-1111-1111-1111-111111111111';
    const embedding = buildEmbedding(1, 0);

    await repository.fetchSemanticLegIds({ tagId, tagName: 'Grain Free' }, embedding, 5);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('product_tags');
    expect(sql).toContain('t.id');
    expect(sql).toContain('::uuid');
    expect(params).toEqual(expect.arrayContaining(['Grain Free', tagId]));
  });
});

describe('Smart Search semantic leg tag filter (e2e)', () => {
  let postgresAvailable = false;
  let vectorAvailable = false;
  let dataSource: DataSource;
  let searchRepository: SearchRepository;
  const seedContext = createSeedRunContext(`smart-search-ac006-${Date.now()}`);

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    dataSource = new DataSource(createTypeOrmTestOptions());
    await dataSource.initialize();

    vectorAvailable = await ensureVectorExtension(dataSource);
    if (!vectorAvailable) {
      return;
    }

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([Product, ProductEmbedding]),
      ],
      providers: [SearchRepository, RankingEngine, VectorSearchSupport],
    }).compile();

    searchRepository = moduleFixture.get(SearchRepository);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupSeedRun(dataSource, seedContext);
      await dataSource.destroy();
    }
  });

  const itWhenVector = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!postgresAvailable || !vectorAvailable) {
        console.warn('Skipping: PostgreSQL pgvector extension not available for AC-006 e2e');
        return;
      }

      await fn();
    });
  };

  itWhenVector(
    'AC-006: semantic leg excludes semantically similar products lacking the selected tag',
    async () => {
      const listing = await seedListingParityDataset(dataSource, seedContext);
      const adminId = seedContext.userIds[0];

      const grainFreeTag = await createTestTag(dataSource, seedContext, {
        suffix: 'grain-free',
        createdBy: adminId,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: 'Grain Free',
        slug: 'grain-free',
      });

      const queryEmbedding = buildEmbedding(1, 0);

      const p1Tagged = await createTestProduct(dataSource, seedContext, {
        suffix: 'search-and-tag',
        storeId: listing.approvedStore.id,
        status: ProductStatus.PUBLISHED,
        categoryId: listing.approvedCategory.id,
        tagIds: [grainFreeTag.id],
        name: 'Premium Cat Food Grain Free',
      });

      const p2Untagged = await createTestProduct(dataSource, seedContext, {
        suffix: 'search-only',
        storeId: listing.approvedStore.id,
        status: ProductStatus.PUBLISHED,
        categoryId: listing.approvedCategory.id,
        name: 'Premium Cat Food Classic',
      });

      const similarTaggedEmbedding = buildEmbedding(0.99, 0.01);
      const similarUntaggedEmbedding = buildEmbedding(0.98, 0.02);

      await upsertProductEmbedding(dataSource, p1Tagged.id, similarTaggedEmbedding);
      await upsertProductEmbedding(dataSource, p2Untagged.id, similarUntaggedEmbedding);

      const withoutTagFilter = await searchRepository.fetchSemanticLegIds({}, queryEmbedding, 10);
      expect(withoutTagFilter).toEqual(expect.arrayContaining([p1Tagged.id, p2Untagged.id]));

      const withTagFilter = await searchRepository.fetchSemanticLegIds(
        {
          tagId: grainFreeTag.id,
          tagName: grainFreeTag.name,
        },
        queryEmbedding,
        10,
      );

      expect(withTagFilter).toContain(p1Tagged.id);
      expect(withTagFilter).not.toContain(p2Untagged.id);
    },
  );

  itWhenVector(
    'AC-006: semantic leg applies categoryId FK conjunctively with tag filter',
    async () => {
      const listing = await seedListingParityDataset(dataSource, seedContext);
      const adminId = seedContext.userIds[0];

      const approvedTag = await createTestTag(dataSource, seedContext, {
        suffix: 'category-conjunct',
        createdBy: adminId,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
      });

      const otherStore = await createTestStore(dataSource, seedContext, {
        suffix: 'other-approved-store',
        ownerId: adminId,
        status: listing.approvedStore.status,
        approvedBy: adminId,
      });

      const queryEmbedding = buildEmbedding(1, 0);

      const inCategory = await createTestProduct(dataSource, seedContext, {
        suffix: 'in-category-tagged',
        storeId: listing.approvedStore.id,
        status: ProductStatus.PUBLISHED,
        categoryId: listing.approvedCategory.id,
        tagIds: [approvedTag.id],
        name: 'Category Match Tagged',
      });

      const wrongCategory = await createTestProduct(dataSource, seedContext, {
        suffix: 'wrong-category-tagged',
        storeId: otherStore.id,
        status: ProductStatus.PUBLISHED,
        categoryId: null,
        tagIds: [approvedTag.id],
        name: 'Wrong Category Tagged',
      });

      await upsertProductEmbedding(dataSource, inCategory.id, buildEmbedding(0.99));
      await upsertProductEmbedding(dataSource, wrongCategory.id, buildEmbedding(0.98));

      const ids = await searchRepository.fetchSemanticLegIds(
        {
          categoryId: listing.approvedCategory.id,
          tagId: approvedTag.id,
          tagName: approvedTag.name,
        },
        queryEmbedding,
        10,
      );

      expect(ids).toContain(inCategory.id);
      expect(ids).not.toContain(wrongCategory.id);
    },
  );
});
