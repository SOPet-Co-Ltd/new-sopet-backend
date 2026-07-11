import { DataSource, Repository } from 'typeorm';
import { hashSeedPassword } from '../../src/database/seeds/helpers';
import { User, UserRole } from '../../src/database/entities/user.entity';
import { Store, StoreStatus } from '../../src/database/entities/store.entity';
import { Product, ProductStatus } from '../../src/database/entities/product.entity';
import { Category } from '../../src/database/entities/category.entity';
import { Tag } from '../../src/database/entities/tag.entity';
import { TaxonomyApprovalStatus } from '../../src/database/entities/enums/taxonomy.enums';

export interface SeedRunContext {
  runId: string;
  userIds: string[];
  storeIds: string[];
  categoryIds: string[];
  tagIds: string[];
  productIds: string[];
}

export function createSeedRunContext(runId = `stx-${Date.now()}`): SeedRunContext {
  return {
    runId,
    userIds: [],
    storeIds: [],
    categoryIds: [],
    tagIds: [],
    productIds: [],
  };
}

export interface ListingParitySeedDataset {
  approvedStore: Store;
  suspendedStore: Store;
  approvedCategory: Category;
  publishedApprovedProduct: Product;
  publishedSuspendedProduct: Product;
  draftApprovedProduct: Product;
}

export interface RejectedTaxonomySeedDataset {
  approvedCategory: Category;
  pendingCategory: Category;
  rejectedCategories: Category[];
  approvedTag: Tag;
  pendingTag: Tag;
  rejectedTags: Tag[];
}

function slugFor(runId: string, suffix: string): string {
  return `${runId}-${suffix}`.slice(0, 255);
}

export async function createTestUser(
  dataSource: DataSource,
  context: SeedRunContext,
  input: {
    suffix: string;
    role: UserRole;
    emailDomain?: string;
  },
): Promise<User> {
  const userRepo = dataSource.getRepository(User);
  const email = `${context.runId}-${input.suffix}@${input.emailDomain ?? 'sopet-e2e.test'}`;

  const user = await userRepo.save(
    userRepo.create({
      email,
      passwordHash: await hashSeedPassword('e2e-test-password'),
      fullName: `E2E ${input.suffix}`,
      role: input.role,
      emailVerified: true,
      isActive: true,
    }),
  );

  context.userIds.push(user.id);
  return user;
}

export async function createTestStore(
  dataSource: DataSource,
  context: SeedRunContext,
  input: {
    suffix: string;
    ownerId: string;
    status: StoreStatus;
    approvedBy?: string;
  },
): Promise<Store> {
  const storeRepo = dataSource.getRepository(Store);
  const slug = slugFor(context.runId, input.suffix);

  const store = await storeRepo.save(
    storeRepo.create({
      ownerId: input.ownerId,
      name: `E2E Store ${input.suffix}`,
      slug,
      description: `Search taxonomy harness store (${input.status})`,
      status: input.status,
      approvedBy:
        input.status === StoreStatus.APPROVED ? (input.approvedBy ?? input.ownerId) : null,
      approvedAt: input.status === StoreStatus.APPROVED ? new Date() : null,
      contactEmail: `${slug}@sopet-e2e.test`,
      contactPhone: '+66800000000',
      address: 'E2E test address',
    }),
  );

  context.storeIds.push(store.id);
  return store;
}

export async function createTestCategory(
  dataSource: DataSource,
  context: SeedRunContext,
  input: {
    suffix: string;
    createdBy: string;
    approvalStatus: TaxonomyApprovalStatus;
    name?: string;
    slug?: string;
  },
): Promise<Category> {
  const categoryRepo = dataSource.getRepository(Category);
  const slug = input.slug ?? slugFor(context.runId, `cat-${input.suffix}`);

  const category = await categoryRepo.save(
    categoryRepo.create({
      name: input.name ?? `E2E Category ${input.suffix} ${context.runId}`,
      slug,
      approvalStatus: input.approvalStatus,
      createdBy: input.createdBy,
      imageUrl:
        input.approvalStatus === TaxonomyApprovalStatus.APPROVED
          ? 'https://cdn.example.com/categories/e2e.webp'
          : null,
    }),
  );

  context.categoryIds.push(category.id);
  return category;
}

export async function createTestTag(
  dataSource: DataSource,
  context: SeedRunContext,
  input: {
    suffix: string;
    createdBy: string;
    approvalStatus: TaxonomyApprovalStatus;
    createdAt?: Date;
    name?: string;
    slug?: string;
  },
): Promise<Tag> {
  const tagRepo = dataSource.getRepository(Tag);
  const slug = input.slug ?? slugFor(context.runId, `tag-${input.suffix}`);

  const tag = await tagRepo.save(
    tagRepo.create({
      name: input.name ?? `E2E Tag ${input.suffix} ${context.runId}`,
      slug,
      approvalStatus: input.approvalStatus,
      createdBy: input.createdBy,
      ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
    }),
  );

  context.tagIds.push(tag.id);
  return tag;
}

export async function createTestProduct(
  dataSource: DataSource,
  context: SeedRunContext,
  input: {
    suffix: string;
    storeId: string;
    status: ProductStatus;
    categoryId?: string | null;
    legacyCategory?: string | null;
    tagIds?: string[];
    name?: string;
  },
): Promise<Product> {
  const productRepo = dataSource.getRepository(Product);
  const slug = slugFor(context.runId, `prod-${input.suffix}`);

  let product = await productRepo.save(
    productRepo.create({
      storeId: input.storeId,
      name: input.name ?? `E2E Product ${input.suffix}`,
      slug,
      description: 'Search taxonomy harness product',
      basePrice: 199,
      status: input.status,
      categoryId: input.categoryId ?? null,
      category: input.legacyCategory ?? null,
      tags: [],
    }),
  );

  if (input.tagIds?.length) {
    const tagRepo = dataSource.getRepository(Tag);
    const tags = await tagRepo.findBy({ id: input.tagIds as never });
    product.taxonomyTags = tags;
    product = await productRepo.save(product);
  }

  context.productIds.push(product.id);
  return product;
}

/** Seed set for listing-parity AC-001–AC-003 (backend-task-02). */
export async function seedListingParityDataset(
  dataSource: DataSource,
  context: SeedRunContext,
): Promise<ListingParitySeedDataset> {
  const admin = await createTestUser(dataSource, context, {
    suffix: 'admin',
    role: UserRole.ADMIN,
  });

  const approvedStore = await createTestStore(dataSource, context, {
    suffix: 'approved-store',
    ownerId: admin.id,
    status: StoreStatus.APPROVED,
    approvedBy: admin.id,
  });

  const suspendedStore = await createTestStore(dataSource, context, {
    suffix: 'suspended-store',
    ownerId: admin.id,
    status: StoreStatus.SUSPENDED,
  });

  const approvedCategory = await createTestCategory(dataSource, context, {
    suffix: 'dog-food',
    createdBy: admin.id,
    approvalStatus: TaxonomyApprovalStatus.APPROVED,
    name: `E2E Dog Food ${context.runId}`,
    slug: slugFor(context.runId, 'dog-food'),
  });

  const publishedApprovedProduct = await createTestProduct(dataSource, context, {
    suffix: 'published-approved',
    storeId: approvedStore.id,
    status: ProductStatus.PUBLISHED,
    categoryId: approvedCategory.id,
    legacyCategory: 'stale-legacy-label',
  });

  const publishedSuspendedProduct = await createTestProduct(dataSource, context, {
    suffix: 'published-suspended',
    storeId: suspendedStore.id,
    status: ProductStatus.PUBLISHED,
    categoryId: approvedCategory.id,
  });

  const draftApprovedProduct = await createTestProduct(dataSource, context, {
    suffix: 'draft-approved',
    storeId: approvedStore.id,
    status: ProductStatus.DRAFT,
    categoryId: approvedCategory.id,
  });

  return {
    approvedStore,
    suspendedStore,
    approvedCategory,
    publishedApprovedProduct,
    publishedSuspendedProduct,
    draftApprovedProduct,
  };
}

/** Seed set for rejected taxonomy AC-009 (backend-task-04). */
export async function seedRejectedTaxonomyDataset(
  dataSource: DataSource,
  context: SeedRunContext,
): Promise<RejectedTaxonomySeedDataset> {
  const admin = await createTestUser(dataSource, context, {
    suffix: 'taxonomy-admin',
    role: UserRole.ADMIN,
  });

  const approvedCategory = await createTestCategory(dataSource, context, {
    suffix: 'cat-approved',
    createdBy: admin.id,
    approvalStatus: TaxonomyApprovalStatus.APPROVED,
    name: `E2E Approved Cat ${context.runId}`,
  });

  const pendingCategory = await createTestCategory(dataSource, context, {
    suffix: 'cat-pending',
    createdBy: admin.id,
    approvalStatus: TaxonomyApprovalStatus.PENDING,
    name: `E2E Pending Cat ${context.runId}`,
  });

  const rejectedCategories = await Promise.all(
    ['R1', 'R2'].map((suffix) =>
      createTestCategory(dataSource, context, {
        suffix: `cat-rejected-${suffix}`,
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.REJECTED,
        name: `E2E Rejected ${suffix} ${context.runId}`,
      }),
    ),
  );

  const baseTagTime = new Date('2024-01-01T00:00:00.000Z');

  const approvedTag = await createTestTag(dataSource, context, {
    suffix: 'tag-approved',
    createdBy: admin.id,
    approvalStatus: TaxonomyApprovalStatus.APPROVED,
    name: `E2E Approved Tag ${context.runId}`,
    createdAt: new Date(baseTagTime.getTime() + 3_000),
  });

  const pendingTag = await createTestTag(dataSource, context, {
    suffix: 'tag-pending',
    createdBy: admin.id,
    approvalStatus: TaxonomyApprovalStatus.PENDING,
    name: `E2E Pending Tag ${context.runId}`,
    createdAt: new Date(baseTagTime.getTime() + 2_000),
  });

  const rejectedTags = await Promise.all(
    ['T1', 'T2'].map((suffix, index) =>
      createTestTag(dataSource, context, {
        suffix: `tag-rejected-${suffix}`,
        createdBy: admin.id,
        approvalStatus: TaxonomyApprovalStatus.REJECTED,
        name: `E2E Rejected Tag ${suffix} ${context.runId}`,
        createdAt: new Date(baseTagTime.getTime() + index * 1_000),
      }),
    ),
  );

  return {
    approvedCategory,
    pendingCategory,
    rejectedCategories,
    approvedTag,
    pendingTag,
    rejectedTags,
  };
}

async function deleteByIds<T extends { id: string }>(
  repository: Repository<T>,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  await repository.delete(ids);
}

/** Removes rows created during a harness seed run (FK-safe order). */
export async function cleanupSeedRun(
  dataSource: DataSource,
  context: SeedRunContext,
): Promise<void> {
  if (context.productIds.length > 0) {
    await dataSource.query(`DELETE FROM product_tags WHERE product_id = ANY($1::uuid[])`, [
      context.productIds,
    ]);
  }

  await deleteByIds(dataSource.getRepository(Product), context.productIds);
  await deleteByIds(dataSource.getRepository(Store), context.storeIds);
  await deleteByIds(dataSource.getRepository(Category), context.categoryIds);
  await deleteByIds(dataSource.getRepository(Tag), context.tagIds);
  await deleteByIds(dataSource.getRepository(User), context.userIds);
}
