// Search & Taxonomy Fixes — Category Delete Atomicity (AC-012–AC-017)
// Promoted from search-taxonomy-delete-atomicity.service.e2e.test.ts (qa-task-01)

import { DataSource } from 'typeorm';
import { TaxonomyApprovalStatus } from '../src/database/entities/enums/taxonomy.enums';
import { Category } from '../src/database/entities/category.entity';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { UserRole } from '../src/database/entities/user.entity';
import { StoreStatus } from '../src/database/entities/store.entity';
import { TaxonomyService } from '../src/modules/taxonomy/taxonomy.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  cleanupSeedRun,
  closeSearchTaxonomyGraphqlE2eHarness,
  createSearchTaxonomyGraphqlE2eHarness,
  createSeedRunContext,
  createTestCategory,
  createTestProduct,
  createTestStore,
  createTestUser,
  isPostgresAvailable,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';
import type { SearchTaxonomyGraphqlE2eHarness } from './helpers/graphql-e2e-harness';

describe('Search taxonomy delete atomicity (e2e)', () => {
  let postgresAvailable = false;
  let dataSource: DataSource;
  let harness: SearchTaxonomyGraphqlE2eHarness | undefined;
  let taxonomyService: TaxonomyService;
  const seedContext = createSeedRunContext(`stx-delete-atomicity-${Date.now()}`);

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    dataSource = new DataSource(createTypeOrmTestOptions());
    await dataSource.initialize();
    harness = await createSearchTaxonomyGraphqlE2eHarness();
    taxonomyService = harness.moduleFixture.get(TaxonomyService);

    const notificationsService = harness.moduleFixture.get(NotificationsService);
    notificationsService.notifyVendorsAboutTaxonomyDeleted = jest.fn().mockResolvedValue(0);
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
        console.warn('Skipping: PostgreSQL not available for delete-atomicity e2e');
        return;
      }

      await fn();
    });
  };

  itWhenPostgres(
    'AC-012/013/015: deleteCategory reassigns active products, syncs legacy name, removes source category',
    async () => {
      const admin = await createTestUser(dataSource, seedContext, {
        suffix: 'delete-admin',
        role: UserRole.ADMIN,
      });
      const store = await createTestStore(dataSource, seedContext, {
        suffix: 'delete-store',
        ownerId: admin.id,
        status: StoreStatus.APPROVED,
        approvedBy: admin.id,
      });

      const sourceCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'source-cat',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Source Category ${seedContext.runId}`,
      });
      const replacementCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'replacement-cat',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Replacement Category ${seedContext.runId}`,
      });

      const activeProducts = await Promise.all(
        ['active-1', 'active-2', 'active-3'].map((suffix) =>
          createTestProduct(dataSource, seedContext, {
            suffix,
            storeId: store.id,
            status: ProductStatus.PUBLISHED,
            categoryId: sourceCategory.id,
            legacyCategory: 'stale-legacy-name',
          }),
        ),
      );

      const softDeletedProduct = await createTestProduct(dataSource, seedContext, {
        suffix: 'soft-deleted',
        storeId: store.id,
        status: ProductStatus.PUBLISHED,
        categoryId: sourceCategory.id,
        legacyCategory: 'soft-deleted-legacy',
      });
      await dataSource.getRepository(Product).softDelete(softDeletedProduct.id);

      const result = await taxonomyService.deleteCategory(
        sourceCategory.id,
        replacementCategory.id,
      );

      expect(result).toMatchObject({
        success: true,
        deletedId: sourceCategory.id,
        deletedCategoryId: sourceCategory.id,
        reassignedProductCount: activeProducts.length,
        replacementCategoryId: replacementCategory.id,
        detachedProductCount: 0,
      });

      const productRepo = dataSource.getRepository(Product);
      const remainingActiveOnSource = await productRepo
        .createQueryBuilder('product')
        .where('product.category_id = :categoryId', { categoryId: sourceCategory.id })
        .getCount();
      expect(remainingActiveOnSource).toBe(0);

      for (const product of activeProducts) {
        const reloaded = await productRepo.findOneByOrFail({ id: product.id });
        expect(reloaded.categoryId).toBe(replacementCategory.id);
        expect(reloaded.category).toBe(replacementCategory.name);
      }

      const softDeletedReloaded = await productRepo.findOne({
        where: { id: softDeletedProduct.id },
        withDeleted: true,
      });
      expect(softDeletedReloaded?.categoryId).not.toBe(replacementCategory.id);
      expect(softDeletedReloaded?.category).toBe('soft-deleted-legacy');

      const sourceRow = await dataSource.getRepository(Category).findOneBy({
        id: sourceCategory.id,
      });
      expect(sourceRow).toBeNull();
    },
  );

  itWhenPostgres(
    'AC-014: transaction rolls back when category DELETE fails after product UPDATE',
    async () => {
      const admin = await createTestUser(dataSource, seedContext, {
        suffix: 'rollback-admin',
        role: UserRole.ADMIN,
      });
      const store = await createTestStore(dataSource, seedContext, {
        suffix: 'rollback-store',
        ownerId: admin.id,
        status: StoreStatus.APPROVED,
        approvedBy: admin.id,
      });

      const sourceCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'rollback-source',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Rollback Source ${seedContext.runId}`,
      });
      const replacementCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'rollback-replacement',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Rollback Replacement ${seedContext.runId}`,
      });

      const boundProducts = await Promise.all(
        ['rollback-1', 'rollback-2'].map((suffix) =>
          createTestProduct(dataSource, seedContext, {
            suffix,
            storeId: store.id,
            status: ProductStatus.PUBLISHED,
            categoryId: sourceCategory.id,
            legacyCategory: sourceCategory.name,
          }),
        ),
      );

      const serviceDataSource = harness!.moduleFixture.get(DataSource);
      const originalTransaction = serviceDataSource.transaction.bind(serviceDataSource);
      const transactionSpy = jest
        .spyOn(serviceDataSource, 'transaction')
        .mockImplementation(async (runInTransaction) =>
          originalTransaction(async (manager) => {
            const originalDelete = manager.delete.bind(manager);
            jest.spyOn(manager, 'delete').mockImplementation(async (target, criteria) => {
              if (target === Category) {
                throw new Error('Simulated category DELETE failure');
              }
              return originalDelete(target, criteria);
            });
            return runInTransaction(manager);
          }),
        );

      await expect(
        taxonomyService.deleteCategory(sourceCategory.id, replacementCategory.id),
      ).rejects.toThrow('Simulated category DELETE failure');

      transactionSpy.mockRestore();

      const productRepo = dataSource.getRepository(Product);
      for (const product of boundProducts) {
        const reloaded = await productRepo.findOneByOrFail({ id: product.id });
        expect(reloaded.categoryId).toBe(sourceCategory.id);
        expect(reloaded.category).toBe(sourceCategory.name);
      }

      const sourceRow = await dataSource.getRepository(Category).findOneBy({
        id: sourceCategory.id,
      });
      expect(sourceRow).not.toBeNull();

      const onReplacement = await productRepo.count({
        where: { categoryId: replacementCategory.id },
      });
      expect(onReplacement).toBe(0);
    },
  );

  itWhenPostgres(
    'AC-016/017: impact excludes soft-deleted rows; empty category deletes without replacement',
    async () => {
      const admin = await createTestUser(dataSource, seedContext, {
        suffix: 'impact-admin',
        role: UserRole.ADMIN,
      });
      const store = await createTestStore(dataSource, seedContext, {
        suffix: 'impact-store',
        ownerId: admin.id,
        status: StoreStatus.APPROVED,
        approvedBy: admin.id,
      });

      const emptyCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'empty-cat',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Empty Category ${seedContext.runId}`,
      });

      const softOnlyProduct = await createTestProduct(dataSource, seedContext, {
        suffix: 'empty-soft-only',
        storeId: store.id,
        status: ProductStatus.PUBLISHED,
        categoryId: emptyCategory.id,
      });
      await dataSource.getRepository(Product).softDelete(softOnlyProduct.id);

      const emptyImpact = await taxonomyService.getCategoryDeleteImpact(emptyCategory.id);
      expect(emptyImpact.productCount).toBe(0);
      expect(emptyImpact.products).toEqual([]);

      const emptyDeleteResult = await taxonomyService.deleteCategory(emptyCategory.id);
      expect(emptyDeleteResult).toMatchObject({
        success: true,
        deletedId: emptyCategory.id,
        deletedCategoryId: emptyCategory.id,
        reassignedProductCount: 0,
        replacementCategoryId: null,
      });

      const populatedCategory = await createTestCategory(dataSource, seedContext, {
        suffix: 'populated-cat',
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        name: `Populated Category ${seedContext.runId}`,
      });

      await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          createTestProduct(dataSource, seedContext, {
            suffix: `impact-active-${index}`,
            storeId: store.id,
            status: ProductStatus.PUBLISHED,
            categoryId: populatedCategory.id,
            name: `Impact Product ${String(index).padStart(2, '0')} ${seedContext.runId}`,
          }),
        ),
      );

      const softOnPopulated = await createTestProduct(dataSource, seedContext, {
        suffix: 'impact-soft',
        storeId: store.id,
        status: ProductStatus.PUBLISHED,
        categoryId: populatedCategory.id,
      });
      await dataSource.getRepository(Product).softDelete(softOnPopulated.id);

      const populatedImpact = await taxonomyService.getCategoryDeleteImpact(populatedCategory.id);
      expect(populatedImpact.productCount).toBe(12);
      expect(populatedImpact.products).toHaveLength(10);
      expect(populatedImpact.products.every((product) => product.name.length > 0)).toBe(true);
    },
  );
});
