// Promotion Create Matrix [service-integration-e2e]
// Creates every PromotionType × condition set for PLATFORM (admin) and STORE (vendor)
// and asserts rows persist in PostgreSQL via PromotionsService.create.
//
// AC: Admin/vendor can create every promotion type with every supported condition combination
// Behavior: Seed catalog → createPromotion (service) for each matrix cell → reload from DB
//   → scope/storeId/type/conditions/code match
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system — PromotionsService.create, PostgreSQL, Product lookup (BxGy)
// @complexity: medium
// ROI: 72 (BV:8 × Freq:6 + Legal:0 + Defect:24) — write-path persistence + condition
//   normalization not covered by apply-path e2e
//
// @real-dependency: PostgreSQL, TypeORM (promotions, products, stores, users)
// Mock: none (service create path only; no Orders/Omise)

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { CreatePromotionInput } from '../src/modules/promotions/promotions.inputs';
import { Product, ProductStatus } from '../src/database/entities/product.entity';
import { Store, StoreStatus } from '../src/database/entities/store.entity';
import { UserRole } from '../src/database/entities/user.entity';
import { Customer } from '../src/database/entities/customer.entity';
import { Order } from '../src/database/entities/order.entity';
import {
  Promotion,
  PromotionScope,
  PromotionType,
} from '../src/database/entities/promotion.entity';
import { PromotionUsage } from '../src/database/entities/promotion-usage.entity';
import {
  cleanupSeedRun,
  createSeedRunContext,
  createTestProduct,
  createTestStore,
  createTestUser,
  isPostgresAvailable,
} from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

type ConditionSetId = 'none' | 'loggedInOnly' | 'newCustomer' | 'both';

const ALL_TYPES = Object.values(PromotionType);
const ALL_SCOPES = [PromotionScope.PLATFORM, PromotionScope.STORE] as const;
const CONDITION_SETS: ConditionSetId[] = ['none', 'loggedInOnly', 'newCustomer', 'both'];

function discountValueFor(type: PromotionType): number {
  switch (type) {
    case PromotionType.PERCENTAGE:
    case PromotionType.PERCENTAGE_SHIPPING_DISCOUNT:
      return 15;
    case PromotionType.FIXED_AMOUNT:
    case PromotionType.FIXED_SHIPPING_DISCOUNT:
      return 50;
    case PromotionType.FREE_SHIPPING:
    case PromotionType.BUY_X_GET_Y:
      return 0;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

function universalConditions(setId: ConditionSetId): Record<string, unknown> {
  switch (setId) {
    case 'none':
      return {};
    case 'loggedInOnly':
      return { loggedInOnly: { enabled: true } };
    case 'newCustomer':
      return { newCustomer: { enabled: true, nDays: 14 } };
    case 'both':
      return {
        loggedInOnly: { enabled: true },
        newCustomer: { enabled: true, nDays: 7 },
      };
    default: {
      const _exhaustive: never = setId;
      return _exhaustive;
    }
  }
}

/** Expected conditions after create (Rule L5 normalizes loggedInOnly to {enabled:true}). */
function expectedConditions(
  setId: ConditionSetId,
  type: PromotionType,
  productId: string,
): Record<string, unknown> {
  const base = universalConditions(setId);
  if (type !== PromotionType.BUY_X_GET_Y) {
    return base;
  }
  return {
    ...base,
    productId,
    buyQuantity: 2,
    getQuantity: 1,
  };
}

function buildConditionsJson(
  setId: ConditionSetId,
  type: PromotionType,
  productId: string,
): string | undefined {
  const conditions = expectedConditions(setId, type, productId);
  if (Object.keys(conditions).length === 0) {
    return undefined;
  }
  return JSON.stringify(conditions);
}

/** Short unique token so codes stay ≤ 50 chars. */
function codeToken(type: PromotionType, scope: PromotionScope, setId: ConditionSetId): string {
  const typeAbbrev: Record<PromotionType, string> = {
    [PromotionType.PERCENTAGE]: 'PCT',
    [PromotionType.FIXED_AMOUNT]: 'FIX',
    [PromotionType.FREE_SHIPPING]: 'FS',
    [PromotionType.BUY_X_GET_Y]: 'BX',
    [PromotionType.FIXED_SHIPPING_DISCOUNT]: 'FSD',
    [PromotionType.PERCENTAGE_SHIPPING_DISCOUNT]: 'PSD',
  };
  const scopeAbbrev = scope === PromotionScope.PLATFORM ? 'P' : 'S';
  const setAbbrev: Record<ConditionSetId, string> = {
    none: 'N',
    loggedInOnly: 'L',
    newCustomer: 'C',
    both: 'B',
  };
  return `${typeAbbrev[type]}${scopeAbbrev}${setAbbrev[setId]}`;
}

type MatrixCase = {
  type: PromotionType;
  scope: PromotionScope;
  conditionSet: ConditionSetId;
  label: string;
};

function buildMatrix(): MatrixCase[] {
  const cases: MatrixCase[] = [];
  for (const scope of ALL_SCOPES) {
    for (const type of ALL_TYPES) {
      for (const conditionSet of CONDITION_SETS) {
        cases.push({
          type,
          scope,
          conditionSet,
          label: `${scope}/${type}/${conditionSet}`,
        });
      }
    }
  }
  return cases;
}

const MATRIX = buildMatrix();

describe('Promotion create matrix — all types × conditions × scopes (service-integration-e2e)', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let promotionsService: PromotionsService;
  let promotionRepo: Repository<Promotion>;

  const seedContext = createSeedRunContext(`promo-cm-${Date.now()}`);
  const trackedPromotionIds: string[] = [];

  let platformProductId = '';
  let storeProductId = '';
  let vendorStoreId = '';

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    if (!postgresAvailable) {
      return;
    }

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([Promotion, PromotionUsage, Product, Customer, Order, Store]),
      ],
      providers: [PromotionsService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    promotionsService = moduleFixture.get(PromotionsService);
    promotionRepo = moduleFixture.get(getRepositoryToken(Promotion));

    const admin = await createTestUser(dataSource, seedContext, {
      suffix: 'admin',
      role: UserRole.ADMIN,
    });
    const vendor = await createTestUser(dataSource, seedContext, {
      suffix: 'vendor',
      role: UserRole.VENDOR,
    });
    const store = await createTestStore(dataSource, seedContext, {
      suffix: 'store',
      ownerId: vendor.id,
      status: StoreStatus.APPROVED,
      approvedBy: admin.id,
    });
    vendorStoreId = store.id;

    // Platform BxGy may reference any catalog product (ADR); store BxGy must own the product.
    const platformProduct = await createTestProduct(dataSource, seedContext, {
      suffix: 'platform-bxgy',
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `Platform BxGy Product ${seedContext.runId}`,
    });
    const storeProduct = await createTestProduct(dataSource, seedContext, {
      suffix: 'store-bxgy',
      storeId: store.id,
      status: ProductStatus.PUBLISHED,
      name: `Store BxGy Product ${seedContext.runId}`,
    });
    platformProductId = platformProduct.id;
    storeProductId = storeProduct.id;
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      if (trackedPromotionIds.length) {
        await promotionRepo.delete(trackedPromotionIds);
      }
      await cleanupSeedRun(dataSource, seedContext);
    }
    if (app) {
      await app.close();
    }
  });

  const itWhenPostgres = (name: string, fn: () => Promise<void>) => {
    it(name, async () => {
      if (!postgresAvailable) {
        console.warn('Skipping: PostgreSQL not available for promotion-create-matrix e2e');
        return;
      }
      await fn();
    });
  };

  itWhenPostgres(
    `creates ${MATRIX.length} promotions (6 types × 4 condition sets × 2 scopes) and persists to DB`,
    async () => {
      expect(MATRIX).toHaveLength(ALL_TYPES.length * CONDITION_SETS.length * ALL_SCOPES.length);

      for (const cell of MATRIX) {
        const productId =
          cell.scope === PromotionScope.PLATFORM ? platformProductId : storeProductId;
        const token = codeToken(cell.type, cell.scope, cell.conditionSet);
        const code = `CM-${token}-${seedContext.runId}`.slice(0, 50);
        const conditionsJson = buildConditionsJson(cell.conditionSet, cell.type, productId);

        const input: CreatePromotionInput = {
          code,
          name: `E2E ${cell.label}`,
          description: `create-matrix ${cell.label}`,
          type: cell.type,
          discountValue: discountValueFor(cell.type),
          isActive: true,
          autoApply: false,
          priority: 0,
          usagePerCustomer: 1,
          conditions: conditionsJson,
        };

        const created =
          cell.scope === PromotionScope.PLATFORM
            ? await promotionsService.create(input, PromotionScope.PLATFORM)
            : await promotionsService.create(input, PromotionScope.STORE, vendorStoreId);

        trackedPromotionIds.push(created.id);

        const fromDb = await promotionRepo.findOneOrFail({ where: { id: created.id } });

        expect(fromDb.code).toBe(code.toUpperCase());
        expect(fromDb.name).toBe(input.name);
        expect(fromDb.type).toBe(cell.type);
        expect(fromDb.scope).toBe(cell.scope);
        expect(Number(fromDb.discountValue)).toBe(discountValueFor(cell.type));
        expect(fromDb.isActive).toBe(true);

        if (cell.scope === PromotionScope.PLATFORM) {
          expect(fromDb.storeId).toBeNull();
        } else {
          expect(fromDb.storeId).toBe(vendorStoreId);
        }

        expect(fromDb.conditions).toEqual(
          expectedConditions(cell.conditionSet, cell.type, productId),
        );
      }

      const count = await promotionRepo
        .createQueryBuilder('p')
        .where('p.id IN (:...ids)', { ids: trackedPromotionIds })
        .getCount();
      expect(count).toBe(MATRIX.length);
    },
  );

  itWhenPostgres(
    'rejects store BxGy when product belongs to a different store (PRODUCT_STORE_MISMATCH)',
    async () => {
      const otherVendor = await createTestUser(dataSource, seedContext, {
        suffix: 'other-vendor',
        role: UserRole.VENDOR,
      });
      const otherStore = await createTestStore(dataSource, seedContext, {
        suffix: 'other-store',
        ownerId: otherVendor.id,
        status: StoreStatus.APPROVED,
        approvedBy: otherVendor.id,
      });
      const foreignProduct = await createTestProduct(dataSource, seedContext, {
        suffix: 'foreign-bxgy',
        storeId: otherStore.id,
        status: ProductStatus.PUBLISHED,
        name: `Foreign BxGy ${seedContext.runId}`,
      });

      const code = `CM-MISMATCH-${seedContext.runId}`.slice(0, 50);
      await expect(
        promotionsService.create(
          {
            code,
            name: 'E2E store BxGy mismatch',
            type: PromotionType.BUY_X_GET_Y,
            discountValue: 0,
            conditions: JSON.stringify({
              productId: foreignProduct.id,
              buyQuantity: 2,
              getQuantity: 1,
            }),
          },
          PromotionScope.STORE,
          vendorStoreId,
        ),
      ).rejects.toMatchObject({
        response: { code: 'PRODUCT_STORE_MISMATCH' },
      });

      const leaked = await promotionRepo.findOne({ where: { code: code.toUpperCase() } });
      expect(leaked).toBeNull();
    },
  );

  itWhenPostgres(
    'rejects invalid newCustomer.nDays on create (INVALID_NEW_CUSTOMER_CONDITIONS)',
    async () => {
      const code = `CM-BADNC-${seedContext.runId}`.slice(0, 50);
      await expect(
        promotionsService.create(
          {
            code,
            name: 'E2E bad newCustomer',
            type: PromotionType.PERCENTAGE,
            discountValue: 10,
            conditions: JSON.stringify({
              newCustomer: { enabled: true, nDays: 0 },
            }),
          },
          PromotionScope.PLATFORM,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_NEW_CUSTOMER_CONDITIONS' },
      });
    },
  );

  itWhenPostgres('rejects buy_x_get_y without productId (INVALID_BXGY_CONDITIONS)', async () => {
    const code = `CM-BADBX-${seedContext.runId}`.slice(0, 50);
    await expect(
      promotionsService.create(
        {
          code,
          name: 'E2E bad BxGy',
          type: PromotionType.BUY_X_GET_Y,
          discountValue: 0,
          conditions: JSON.stringify({
            buyQuantity: 2,
            getQuantity: 1,
            loggedInOnly: { enabled: true },
          }),
        },
        PromotionScope.PLATFORM,
      ),
    ).rejects.toMatchObject({
      response: { code: 'INVALID_BXGY_CONDITIONS' },
    });
  });
});
