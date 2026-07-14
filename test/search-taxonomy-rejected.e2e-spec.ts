// Search & Taxonomy Fixes — Rejected Taxonomy (AC-009)
// Promoted from search-taxonomy-rejected.int.test.ts (backend-task-04)

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { TaxonomyApprovalStatus } from '../src/database/entities/enums/taxonomy.enums';
import { UserRole } from '../src/database/entities/user.entity';
import { Product } from '../src/database/entities/product.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import { ProductImage } from '../src/database/entities/product-image.entity';
import { Store } from '../src/database/entities/store.entity';
import { User } from '../src/database/entities/user.entity';
import { StoreMember } from '../src/database/entities/store-member.entity';
import { Category } from '../src/database/entities/category.entity';
import { Tag } from '../src/database/entities/tag.entity';
import { PetType } from '../src/database/entities/pet-type.entity';
import { Brand } from '../src/database/entities/brand.entity';
import { Order } from '../src/database/entities/order.entity';
import { OrderItem } from '../src/database/entities/order-item.entity';
import { AuditLog } from '../src/database/entities/audit-log.entity';
import { AppGraphqlResolver } from '../src/graphql/app.resolver';
import { GraphqlContextFactory } from '../src/graphql/loaders/graphql-context.factory';
import { ProductsResolver } from '../src/modules/products/products.resolver';
import { ProductsService } from '../src/modules/products/products.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { TaxonomyResolver } from '../src/modules/taxonomy/taxonomy.resolver';
import { TaxonomyService } from '../src/modules/taxonomy/taxonomy.service';
import { searchTaxonomyGraphqlMockProviders } from './helpers/graphql-e2e-harness';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import {
  cleanupSeedRun,
  createSeedRunContext,
  isPostgresAvailable,
  seedRejectedTaxonomyDataset,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';
import type { RejectedTaxonomySeedDataset } from './helpers/seed-factories';

const REJECTED_TAXONOMY_QUERY = `
  query RejectedTaxonomy {
    rejectedCategories { id name approvalStatus }
    rejectedTags { id name approvalStatus createdAt }
  }
`;

interface RejectedTaxonomyBody {
  data?: {
    rejectedCategories: Array<{ id: string; name: string; approvalStatus: string }>;
    rejectedTags: Array<{ id: string; name: string; approvalStatus: string; createdAt: string }>;
  };
  errors?: Array<{ message: string }>;
}

function createTestAuthGuards(): { jwtGuard: CanActivate; rolesGuard: RolesGuard } {
  const reflector = new Reflector();

  const jwtGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const gqlContext = GqlExecutionContext.create(context).getContext<{
        req: {
          headers: Record<string, string | undefined>;
          user?: { id: string; role: string };
        };
      }>();
      const req = gqlContext.req;
      const role = req.headers['x-test-role'];
      const userId = req.headers['x-test-user-id'];

      if (!role || !userId) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      req.user = { id: userId, role };
      return true;
    },
  };

  return { jwtGuard, rolesGuard: new RolesGuard(reflector) };
}

async function createRejectedTaxonomyHarness(): Promise<INestApplication> {
  const { jwtGuard, rolesGuard } = createTestAuthGuards();

  const moduleFixture: TestingModule = await Test.createTestingModule({
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
        Order,
        OrderItem,
        AuditLog,
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
      ...searchTaxonomyGraphqlMockProviders,
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(jwtGuard)
    .overrideGuard(RolesGuard)
    .useValue(rolesGuard)
    .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  return app;
}

describe('Search taxonomy rejected listings (e2e)', () => {
  let postgresAvailable = false;
  let dataSource: DataSource;
  let app: INestApplication | undefined;
  let seed: RejectedTaxonomySeedDataset;
  const seedContext = createSeedRunContext(`stx-rejected-${Date.now()}`);

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    dataSource = new DataSource(createTypeOrmTestOptions());
    await dataSource.initialize();
    app = await createRejectedTaxonomyHarness();
    seed = await seedRejectedTaxonomyDataset(dataSource, seedContext);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await cleanupSeedRun(dataSource, seedContext);
      await dataSource.destroy();
    }

    if (app) {
      await app.close();
    }
  });

  const itWhenPostgres = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!postgresAvailable) {
        console.warn('Skipping: PostgreSQL not available for rejected-taxonomy e2e');
        return;
      }

      await fn();
    });
  };

  const queryRejectedTaxonomy = (headers: Record<string, string>) =>
    request(app!.getHttpServer() as App)
      .post('/graphql')
      .set(headers)
      .send({ query: REJECTED_TAXONOMY_QUERY });

  itWhenPostgres(
    'AC-009: admin GraphQL returns only rejected taxonomy with correct ordering',
    async () => {
      const res = await queryRejectedTaxonomy({
        'x-test-user-id': seed.rejectedCategories[0].createdBy,
        'x-test-role': UserRole.ADMIN,
      }).expect(200);

      const body = res.body as RejectedTaxonomyBody;
      expect(body.errors).toBeUndefined();

      const categoryIds = body.data!.rejectedCategories.map((item) => item.id);
      const tagIds = body.data!.rejectedTags.map((item) => item.id);

      expect(categoryIds).toEqual(
        expect.arrayContaining(seed.rejectedCategories.map((category) => category.id)),
      );
      expect(categoryIds).toHaveLength(2);
      expect(tagIds).toEqual(expect.arrayContaining(seed.rejectedTags.map((tag) => tag.id)));
      expect(tagIds).toHaveLength(2);

      for (const category of body.data!.rejectedCategories) {
        expect(category.approvalStatus).toBe(TaxonomyApprovalStatus.REJECTED);
      }
      for (const tag of body.data!.rejectedTags) {
        expect(tag.approvalStatus).toBe(TaxonomyApprovalStatus.REJECTED);
      }

      expect(categoryIds).not.toContain(seed.approvedCategory.id);
      expect(categoryIds).not.toContain(seed.pendingCategory.id);
      expect(tagIds).not.toContain(seed.approvedTag.id);
      expect(tagIds).not.toContain(seed.pendingTag.id);

      const sortedCategoryNames = [...body.data!.rejectedCategories]
        .map((category) => category.name)
        .sort((a, b) => a.localeCompare(b));
      expect(body.data!.rejectedCategories.map((category) => category.name)).toEqual(
        sortedCategoryNames,
      );

      const sortedTagCreatedAt = [...body.data!.rejectedTags]
        .map((tag) => new Date(tag.createdAt).getTime())
        .sort((a, b) => b - a);
      expect(body.data!.rejectedTags.map((tag) => new Date(tag.createdAt).getTime())).toEqual(
        sortedTagCreatedAt,
      );
    },
  );

  itWhenPostgres('AC-009: non-admin caller is denied', async () => {
    const res = await queryRejectedTaxonomy({
      'x-test-user-id': seed.rejectedCategories[0].createdBy,
      'x-test-role': UserRole.VENDOR,
    }).expect(200);

    const body = res.body as RejectedTaxonomyBody;
    expect(body.data?.rejectedCategories).toBeUndefined();
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  itWhenPostgres('AC-009: rejected queries return arrays without GraphQL errors', async () => {
    const res = await queryRejectedTaxonomy({
      'x-test-user-id': seed.rejectedCategories[0].createdBy,
      'x-test-role': UserRole.ADMIN,
    }).expect(200);

    const body = res.body as RejectedTaxonomyBody;
    expect(body.errors).toBeUndefined();
    expect(Array.isArray(body.data?.rejectedCategories)).toBe(true);
    expect(Array.isArray(body.data?.rejectedTags)).toBe(true);
  });
});
