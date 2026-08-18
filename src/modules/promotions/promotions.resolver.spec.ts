import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '../../common/pipes/validation.pipe';
import { PromotionsResolver } from './promotions.resolver';
import { PromotionsService } from './promotions.service';
import { StoresService } from '../stores/stores.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { PromotionScope, PromotionType } from '../../database/entities/promotion.entity';
import {
  MAX_VALIDATE_PROMOTIONS_TARGETS,
  ValidatePromotionsInput,
  ValidatePromotionsTargetInput,
} from './promotions.inputs';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

describe('PromotionsResolver.validatePromotion', () => {
  let resolver: PromotionsResolver;
  let promotionsService: { validateCode: jest.Mock; validatePromotionsBatch: jest.Mock };
  let storesService: Record<string, never>;

  beforeEach(() => {
    promotionsService = { validateCode: jest.fn(), validatePromotionsBatch: jest.fn() };
    storesService = {};
    resolver = new PromotionsResolver(
      promotionsService as unknown as PromotionsService,
      storesService as unknown as StoresService,
      { log: jest.fn() } as unknown as AuditLogsService,
    );
  });

  it('maps soft eligibility reason and freeUnits without throwing (ADR Decision 5)', async () => {
    promotionsService.validateCode.mockResolvedValue({
      promotion: { code: 'NEWCUST', name: 'New customer' },
      discountAmount: 0,
      freeUnits: 0,
      ineligibilityReason: 'GUEST',
    });

    const result = await resolver.validatePromotion({ code: 'NEWCUST', subtotal: 500 }, undefined);

    expect(promotionsService.validateCode).toHaveBeenCalledWith(
      'NEWCUST',
      500,
      undefined,
      undefined,
      { mode: 'preview', lines: undefined, shippingFee: undefined },
    );
    expect(result).toEqual({
      code: 'NEWCUST',
      name: 'New customer',
      discountAmount: 0,
      ineligibilityReason: 'GUEST',
      freeUnits: 0,
    });
  });

  it('forwards lines and returns freeUnits for eligible BxGy preview', async () => {
    const lines = [
      { productId: '11111111-1111-1111-1111-111111111111', quantity: 3, unitPrice: 100 },
    ];
    promotionsService.validateCode.mockResolvedValue({
      promotion: { code: 'BXGY21', name: 'Buy 2 Get 1' },
      discountAmount: 100,
      freeUnits: 1,
      ineligibilityReason: null,
    });

    const result = await resolver.validatePromotion(
      { code: 'BXGY21', subtotal: 300, lines },
      'cust-1',
    );

    expect(promotionsService.validateCode).toHaveBeenCalledWith(
      'BXGY21',
      300,
      undefined,
      { customerId: 'cust-1' },
      { mode: 'preview', lines, shippingFee: undefined },
    );
    expect(result.freeUnits).toBe(1);
    expect(result.ineligibilityReason).toBeNull();
    expect(result.discountAmount).toBe(100);
  });

  it('propagates hard invalid as BadRequestException', async () => {
    promotionsService.validateCode.mockRejectedValue(
      new BadRequestException({ code: 'INVALID_PROMOTION', message: 'Invalid promo code' }),
    );

    await expect(
      resolver.validatePromotion({ code: 'NOPE', subtotal: 100 }, undefined),
    ).rejects.toMatchObject({ response: { code: 'INVALID_PROMOTION' } });
  });
});

describe('PromotionsResolver.validatePromotions (Decision 6)', () => {
  let resolver: PromotionsResolver;
  let promotionsService: { validateCode: jest.Mock; validatePromotionsBatch: jest.Mock };
  let storesService: Record<string, never>;
  const validationPipe = new ValidationPipe();

  beforeEach(() => {
    promotionsService = { validateCode: jest.fn(), validatePromotionsBatch: jest.fn() };
    storesService = {};
    resolver = new PromotionsResolver(
      promotionsService as unknown as PromotionsService,
      storesService as unknown as StoresService,
      { log: jest.fn() } as unknown as AuditLogsService,
    );
  });

  it('is publicly callable without JWT and omits customerId (guest)', async () => {
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'p1',
          code: 'SAVE10',
          name: 'Save 10%',
          eligible: true,
          ineligibilityReason: null,
          discountAmount: 50,
          freeUnits: 0,
        },
      ],
    });

    const input: ValidatePromotionsInput = {
      promotions: [{ code: 'SAVE10' }],
      subtotal: 500,
    };

    const result = await resolver.validatePromotions(input, undefined);

    expect(promotionsService.validatePromotionsBatch).toHaveBeenCalledWith(
      [{ code: 'SAVE10' }],
      500,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].eligible).toBe(true);
    expect(result.items[0].discountAmount).toBe(50);
  });

  it('forwards optional JWT customerId into validatePromotionsBatch', async () => {
    const lines = [
      { productId: '11111111-1111-1111-1111-111111111111', quantity: 2, unitPrice: 100 },
    ];
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'p2',
          code: 'NEWCUST',
          name: 'New customer',
          eligible: false,
          ineligibilityReason: 'ORDER_HISTORY',
          discountAmount: 0,
          freeUnits: 0,
        },
      ],
    });

    const storeId = '22222222-2222-2222-2222-222222222222';
    const input: ValidatePromotionsInput = {
      promotions: [{ id: 'p2', code: 'NEWCUST' }],
      subtotal: 1000,
      storeId,
      lines,
    };

    const result = await resolver.validatePromotions(input, 'cust-jwt-1');

    expect(promotionsService.validatePromotionsBatch).toHaveBeenCalledWith(
      [{ id: 'p2', code: 'NEWCUST' }],
      1000,
      storeId,
      { customerId: 'cust-jwt-1' },
      lines,
      undefined,
    );
    expect(result.items[0].ineligibilityReason).toBe('ORDER_HISTORY');
    expect(result.items[0].eligible).toBe(false);
  });

  it('returns soft per-item outcomes without aborting the query', async () => {
    promotionsService.validatePromotionsBatch.mockResolvedValue({
      items: [
        {
          id: 'ok',
          code: 'PCT10',
          name: '10%',
          eligible: true,
          ineligibilityReason: null,
          discountAmount: 100,
          freeUnits: 0,
        },
        {
          id: null,
          code: 'BAD',
          name: null,
          eligible: false,
          ineligibilityReason: 'INVALID_PROMOTION',
          discountAmount: 0,
          freeUnits: 0,
        },
      ],
    });

    const result = await resolver.validatePromotions(
      { promotions: [{ code: 'PCT10' }, { code: 'BAD' }], subtotal: 1000 },
      undefined,
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].eligible).toBe(true);
    expect(result.items[1].eligible).toBe(false);
    expect(result.items[1].ineligibilityReason).toBe('INVALID_PROMOTION');
  });

  it('ValidationPipe rejects missing id|code as whole-query (not soft item)', async () => {
    const raw = {
      promotions: [{}],
      subtotal: 100,
    };

    await expect(
      validationPipe.transform(raw, {
        type: 'body',
        metatype: ValidatePromotionsInput,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('ValidationPipe rejects >20 promotions as whole-query', async () => {
    const promotions = Array.from({ length: MAX_VALIDATE_PROMOTIONS_TARGETS + 1 }, (_, i) => {
      const t = new ValidatePromotionsTargetInput();
      t.code = `C${i}`;
      return t;
    });
    const raw = { promotions, subtotal: 100 };

    await expect(
      validationPipe.transform(raw, {
        type: 'body',
        metatype: ValidatePromotionsInput,
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
  });

  it('propagates service INVALID_VALIDATE_PROMOTIONS_INPUT as whole-query', async () => {
    promotionsService.validatePromotionsBatch.mockRejectedValue(
      new BadRequestException({
        code: 'INVALID_VALIDATE_PROMOTIONS_INPUT',
        message: 'promotions must contain between 1 and 20 targets',
      }),
    );

    await expect(
      resolver.validatePromotions({ promotions: [{ code: 'X' }], subtotal: 1 }, undefined),
    ).rejects.toMatchObject({ response: { code: 'INVALID_VALIDATE_PROMOTIONS_INPUT' } });
  });
});

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const VENDOR_ID = '22222222-2222-4222-8222-222222222222';
const PROMO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STORE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-promo-1', headers: { 'x-forwarded-for': '203.0.113.10' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

function platformPromotion(overrides: Record<string, unknown> = {}) {
  return {
    id: PROMO_ID,
    storeId: null,
    code: 'SAVE10',
    name: 'Save 10',
    description: null,
    type: PromotionType.PERCENTAGE,
    scope: PromotionScope.PLATFORM,
    discountValue: 10,
    minPurchaseAmount: null,
    maxDiscountAmount: null,
    usageLimit: null,
    usagePerCustomer: 1,
    usageCount: 0,
    isActive: true,
    autoApply: false,
    priority: 0,
    conditions: {},
    startsAt: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('PromotionsResolver audit logging (AC-B-002)', () => {
  let resolver: PromotionsResolver;
  let promotionsService: {
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    toggle: jest.Mock;
    assertCanManage: jest.Mock;
  };
  let storesService: { assertStoreAccess: jest.Mock };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    promotionsService = {
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
      toggle: jest.fn(),
      assertCanManage: jest.fn(),
    };
    storesService = { assertStoreAccess: jest.fn().mockResolvedValue(undefined) };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = new PromotionsResolver(
      promotionsService as unknown as PromotionsService,
      storesService as unknown as StoresService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  const createInput = {
    code: 'SAVE10',
    name: 'Save 10',
    type: PromotionType.PERCENTAGE,
    discountValue: 10,
  };

  it('logs promotion.created once for admin PLATFORM create', async () => {
    promotionsService.create.mockResolvedValue(platformPromotion());

    await resolver.createPromotion(
      createInput,
      ADMIN_ID,
      'admin',
      undefined,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: ADMIN_ID,
        actorLabel: ADMIN_EMAIL,
        action: AuditAction.PROMOTION_CREATED,
        resourceType: AuditResourceType.PROMOTION,
        resourceId: PROMO_ID,
        metadata: { scope: PromotionScope.PLATFORM, isActive: true },
        requestId: 'req-promo-1',
      }),
    );
  });

  it('does not log when vendor creates a STORE promotion', async () => {
    promotionsService.create.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID }),
    );

    await resolver.createPromotion(createInput, VENDOR_ID, 'vendor', STORE_ID);

    expect(storesService.assertStoreAccess).toHaveBeenCalled();
    expect(auditLogsService.log).not.toHaveBeenCalled();
  });

  it('logs promotion.updated once for admin and skips vendor', async () => {
    const promo = platformPromotion();
    promotionsService.findOne.mockResolvedValue(promo);
    promotionsService.update.mockResolvedValue(promo);

    await resolver.updatePromotion(
      PROMO_ID,
      { name: 'Save 15' },
      ADMIN_ID,
      'admin',
      undefined,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PROMOTION_UPDATED,
        resourceType: AuditResourceType.PROMOTION,
        resourceId: PROMO_ID,
        metadata: { scope: PromotionScope.PLATFORM, isActive: true },
      }),
    );

    auditLogsService.log.mockClear();
    promotionsService.findOne.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID }),
    );
    promotionsService.update.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID }),
    );

    await resolver.updatePromotion(PROMO_ID, { name: 'Store save' }, VENDOR_ID, 'vendor', STORE_ID);

    expect(auditLogsService.log).not.toHaveBeenCalled();
  });

  it('logs promotion.deleted once for admin and skips vendor', async () => {
    promotionsService.findOne.mockResolvedValue(platformPromotion());
    promotionsService.softDelete.mockResolvedValue(undefined);

    await resolver.deletePromotion(
      PROMO_ID,
      ADMIN_ID,
      'admin',
      undefined,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PROMOTION_DELETED,
        resourceType: AuditResourceType.PROMOTION,
        resourceId: PROMO_ID,
        metadata: { scope: PromotionScope.PLATFORM, isActive: true },
      }),
    );

    auditLogsService.log.mockClear();
    promotionsService.findOne.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID }),
    );

    await resolver.deletePromotion(PROMO_ID, VENDOR_ID, 'vendor', STORE_ID);

    expect(auditLogsService.log).not.toHaveBeenCalled();
  });

  it('logs promotion.toggled once for admin and skips vendor', async () => {
    promotionsService.findOne.mockResolvedValue(platformPromotion());
    promotionsService.toggle.mockResolvedValue(platformPromotion({ isActive: false }));

    await resolver.togglePromotion(
      PROMO_ID,
      false,
      ADMIN_ID,
      'admin',
      undefined,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PROMOTION_TOGGLED,
        resourceType: AuditResourceType.PROMOTION,
        resourceId: PROMO_ID,
        metadata: { scope: PromotionScope.PLATFORM, isActive: false },
      }),
    );

    auditLogsService.log.mockClear();
    promotionsService.findOne.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID }),
    );
    promotionsService.toggle.mockResolvedValue(
      platformPromotion({ scope: PromotionScope.STORE, storeId: STORE_ID, isActive: false }),
    );

    await resolver.togglePromotion(PROMO_ID, false, VENDOR_ID, 'vendor', STORE_ID);

    expect(auditLogsService.log).not.toHaveBeenCalled();
  });
});
