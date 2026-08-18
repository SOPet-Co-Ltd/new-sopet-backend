import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutSettlementRail, PayoutStatus } from '../../database/entities/payout.entity';
import { PaymentMethod } from '../../database/entities/order.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OmiseService } from '../omise/omise.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as payoutCommissionCalculator from './payout-commission.calculator';

function createQueryBuilderMock(result: Record<string, string>) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    subQuery: jest.fn().mockReturnThis(),
    getQuery: jest.fn().mockReturnValue('(SELECT 1)'),
    getRawOne: jest.fn().mockResolvedValue(result),
    getRawMany: jest.fn().mockResolvedValue([]),
  };
}

describe('PayoutsService', () => {
  let service: PayoutsService;
  const payoutRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'payout-1', createdAt: new Date('2026-07-01') })),
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const storeRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => x),
  };
  const orderItemRepo = {
    createQueryBuilder: jest.fn(),
  };
  const managerStoreQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ id: 'store-1' }),
  };
  const managerPayoutQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  };
  const managerStoreRepo = {
    createQueryBuilder: jest.fn(() => managerStoreQueryBuilder),
  };
  const managerPayoutRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({
      ...x,
      id: x.id ?? 'payout-1',
      createdAt: new Date('2026-07-01'),
    })),
    createQueryBuilder: jest.fn(() => managerPayoutQueryBuilder),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) =>
      entity === Store ? managerStoreRepo : managerPayoutRepo,
    ),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => cb(manager)),
    createQueryBuilder: jest.fn(),
  };
  const omiseService = {
    hasCredentials: jest.fn().mockReturnValue(false),
    createTransfer: jest.fn(),
    getRecipient: jest.fn(),
    getTransfer: jest.fn(),
  };
  const notificationsService = {
    notifyAdminsAboutManualPayoutRequest: jest.fn().mockResolvedValue(null),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'payout.minPayoutAmount') return 500;
      if (key === 'commission.defaultRatePercent') return 7;
      return undefined;
    }),
  };

  const GO_LIVE_AT = new Date('2026-06-01T00:00:00.000Z');

  function historicalPayout(amount: number, id: string) {
    return {
      id,
      amount,
      productSold: null,
      shippingFees: null,
      commissionAmount: null,
      commissionRate: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
  }

  function expectFoursIdentity(
    summary: {
      productSold?: number;
      shippingFees?: number;
      commissionAmount?: number;
      commissionRate?: number;
      availableBalance: number;
      omise: {
        productSold?: number;
        shippingFees?: number;
        commissionAmount?: number;
        commissionRate?: number;
        availableBalance: number;
      };
    },
    expected: {
      productSold: number;
      shippingFees: number;
      commissionAmount: number;
      commissionRate: number;
      availableBalance: number;
    },
  ) {
    expect(summary.productSold).toBe(expected.productSold);
    expect(summary.shippingFees).toBe(expected.shippingFees);
    expect(summary.commissionAmount).toBe(expected.commissionAmount);
    expect(summary.commissionRate).toBe(expected.commissionRate);
    expect(summary.availableBalance).toBe(expected.availableBalance);
    expect(summary.omise.productSold).toBe(expected.productSold);
    expect(summary.omise.shippingFees).toBe(expected.shippingFees);
    expect(summary.omise.commissionAmount).toBe(expected.commissionAmount);
    expect(summary.omise.commissionRate).toBe(expected.commissionRate);
    expect(summary.omise.availableBalance).toBe(expected.availableBalance);
    expect(summary.availableBalance).toBe(
      expected.productSold - expected.commissionAmount + expected.shippingFees,
    );
    expect(summary).not.toHaveProperty('pre_productSold');
    expect(summary).not.toHaveProperty('post_productSold');
    expect(summary.omise).not.toHaveProperty('pre_productSold');
    expect(summary.omise).not.toHaveProperty('post_productSold');
  }

  function createCutoffAwareQb(pre: string, post: string) {
    const state: { cutoff?: 'pre' | 'post' } = {};
    const qb = createQueryBuilderMock({
      total: String(Number(pre) + Number(post)),
    });
    qb.andWhere.mockImplementation((clause: string, params?: { goLiveAt?: Date }) => {
      if (params?.goLiveAt) {
        if (/>=/.test(clause)) state.cutoff = 'post';
        else if (/IS NULL|</.test(clause)) state.cutoff = 'pre';
      }
      return qb;
    });
    qb.getRawOne.mockImplementation(async () => {
      if (state.cutoff === 'pre') return { total: pre };
      if (state.cutoff === 'post') return { total: post };
      return { total: String(Number(pre) + Number(post)) };
    });
    return qb;
  }

  function isShippingSliceEntity(entity: { name?: string } | undefined) {
    const name = entity?.name ?? '';
    return name.includes('OrderStoreShipping') || name.includes('OrderItem');
  }

  function mockCutoffQueries(opts: {
    preTotal: string;
    postTotal: string;
    promoPre?: string;
    promoPost?: string;
    shipping?: string;
  }) {
    const itemQbs: ReturnType<typeof createQueryBuilderMock>[] = [];
    const promoQbs: ReturnType<typeof createQueryBuilderMock>[] = [];
    orderItemRepo.createQueryBuilder.mockImplementation(() => {
      const qb = createCutoffAwareQb(opts.preTotal, opts.postTotal);
      itemQbs.push(qb);
      return qb;
    });
    payoutRepo.createQueryBuilder.mockImplementation(() => createQueryBuilderMock({ total: '0' }));
    const shippingQb = createQueryBuilderMock({ total: opts.shipping ?? '0' });
    const lifetimeProduct = String(Number(opts.preTotal) + Number(opts.postTotal));
    shippingQb.getRawMany.mockResolvedValue([
      { product: lifetimeProduct, shipping: opts.shipping ?? '0' },
    ]);
    dataSource.createQueryBuilder.mockImplementation((entity: { name?: string } | undefined) => {
      if (isShippingSliceEntity(entity)) {
        return shippingQb;
      }
      const promoQb = createCutoffAwareQb(opts.promoPre ?? '0', opts.promoPost ?? '0');
      promoQbs.push(promoQb);
      return promoQb;
    });
    return { itemQbs, promoQbs, shippingQb };
  }

  function mockPromoQuery(promoQb: ReturnType<typeof createQueryBuilderMock>, shippingTotal = '0') {
    dataSource.createQueryBuilder.mockImplementation((entity?: { name?: string }) => {
      if (isShippingSliceEntity(entity)) {
        return createQueryBuilderMock({ total: shippingTotal });
      }
      return promoQb;
    });
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    configService.get.mockImplementation((key: string) => {
      if (key === 'payout.minPayoutAmount') return 500;
      if (key === 'commission.defaultRatePercent') return 7;
      return undefined;
    });
    omiseService.hasCredentials.mockReturnValue(false);
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      name: 'Test Store',
      commissionRate: null,
    });
    payoutRepo.findOne.mockResolvedValue(null);
    payoutRepo.find.mockResolvedValue([]);
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
    payoutRepo.createQueryBuilder.mockImplementation(() =>
      createQueryBuilderMock({ total: '1000' }),
    );
    // Default: no store-scoped promotion usage, so existing tests keep computing
    // grossRevenue purely from item subtotal (no discount deducted).
    dataSource.createQueryBuilder.mockImplementation(() => createQueryBuilderMock({ total: '0' }));
    managerStoreQueryBuilder.getOne.mockResolvedValue({ id: 'store-1' });
    managerPayoutQueryBuilder.getOne.mockResolvedValue(null);
    managerPayoutRepo.findOne.mockResolvedValue(null);
    managerPayoutRepo.save.mockImplementation(async (x: Record<string, unknown>) => ({
      ...x,
      id: (x.id as string | undefined) ?? 'payout-1',
      createdAt: new Date('2026-07-01'),
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getRepositoryToken(Payout), useValue: payoutRepo },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: OmiseService, useValue: omiseService },
        { provide: ConfigService, useValue: configService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get(PayoutsService);
  });

  it('creates manual payout for existing store', async () => {
    const payout = await service.createManualPayout('store-1', 1500);

    expect(managerPayoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        amount: 1500,
        fee: 0,
        netAmount: 1500,
        productSold: 1612.9,
        shippingFees: 0,
        commissionAmount: 112.9,
        commissionRate: 7,
        status: PayoutStatus.PENDING,
        settlementRail: 'omise',
      }),
    );
    expect(payout.id).toBe('payout-1');
  });

  it('creates an Omise transfer for stores with an active recipient', async () => {
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      omiseRecipientId: 'recp_test_1',
      omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
    });
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.getRecipient.mockResolvedValue({
      id: 'recp_test_1',
      verified: true,
      active: true,
    });
    omiseService.createTransfer.mockResolvedValue({ id: 'trsf_test_1', paid: false });

    const payout = await service.createManualPayout('store-1', 1500);

    expect(omiseService.createTransfer).toHaveBeenCalledWith('recp_test_1', 150000);
    expect(payout.transferReference).toBe('trsf_test_1');
    expect(payout.status).toBe(PayoutStatus.PROCESSING);
  });

  it('refreshes pending recipient and creates transfer when Omise has activated it', async () => {
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      omiseRecipientId: 'recp_test_1',
      omiseRecipientStatus: OmiseRecipientStatus.PENDING,
    });
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.getRecipient.mockResolvedValue({
      id: 'recp_test_1',
      verified: true,
      active: true,
    });
    omiseService.createTransfer.mockResolvedValue({ id: 'trsf_test_2', paid: false });

    const payout = await service.createManualPayout('store-1', 1500);

    expect(storeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ omiseRecipientStatus: OmiseRecipientStatus.ACTIVE }),
    );
    expect(omiseService.createTransfer).toHaveBeenCalledWith('recp_test_1', 150000);
    expect(payout.status).toBe(PayoutStatus.PROCESSING);
  });

  it('rejects payout when Omise recipient is still pending after refresh', async () => {
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      omiseRecipientId: 'recp_test_1',
      omiseRecipientStatus: OmiseRecipientStatus.PENDING,
    });
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.getRecipient.mockResolvedValue({
      id: 'recp_test_1',
      verified: false,
      active: false,
    });

    await expect(service.createManualPayout('store-1', 1500)).rejects.toThrow(BadRequestException);
    expect(omiseService.createTransfer).not.toHaveBeenCalled();
  });

  it('retries Omise transfer for orphan pending payouts', async () => {
    const orphan = {
      id: 'payout-orphan',
      storeId: 'store-1',
      amount: 2050,
      netAmount: 2050,
      status: PayoutStatus.PENDING,
      transferReference: null,
      failureReason: null,
    };
    payoutRepo.findOne.mockResolvedValue(orphan);
    managerPayoutQueryBuilder.getOne.mockResolvedValue({ ...orphan });
    storeRepo.findOne.mockResolvedValue({
      id: 'store-1',
      omiseRecipientId: 'recp_test_1',
      omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
    });
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.getRecipient.mockResolvedValue({
      id: 'recp_test_1',
      verified: true,
      active: true,
    });
    omiseService.createTransfer.mockResolvedValue({ id: 'trsf_retry_1', paid: false });

    const payout = await service.requestPayout('store-1', 'vendor-1');

    expect(omiseService.createTransfer).toHaveBeenCalledWith('recp_test_1', 205000);
    expect(payout.transferReference).toBe('trsf_retry_1');
    expect(payout.status).toBe(PayoutStatus.PROCESSING);
  });

  it('marks payout completed on transfer.pay webhook', async () => {
    const payout = {
      id: 'payout-1',
      status: PayoutStatus.PROCESSING,
      transferReference: 'trsf_1',
      failureReason: null,
      processedAt: null,
    };
    payoutRepo.findOne.mockResolvedValue(payout);
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.getTransfer.mockResolvedValue({
      id: 'trsf_1',
      paid: true,
      sent: true,
      amount: 100,
      currency: 'thb',
    });

    await service.handleOmiseTransferWebhook({
      key: 'transfer.pay',
      data: { object: 'transfer', id: 'trsf_1', paid: true },
    });

    expect(payoutRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PayoutStatus.COMPLETED }),
    );
  });

  it('throws when store not found', async () => {
    storeRepo.findOne.mockResolvedValue(null);

    await expect(service.createManualPayout('missing', 100)).rejects.toThrow(NotFoundException);
  });

  it('lists payouts by store', async () => {
    payoutRepo.find.mockResolvedValue([{ id: 'payout-1' }]);

    const payouts = await service.findByStore('store-1');
    expect(payouts).toHaveLength(1);
  });

  it('calculates payout summary with available balance', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
    payoutRepo.createQueryBuilder.mockImplementation(() => {
      const state: { statuses?: string[] } = {};
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn((_clause: string, params?: { statuses?: string[] }) => {
          if (params?.statuses) state.statuses = params.statuses;
          return qb;
        }),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => {
          const isPaidOutQuery = state.statuses?.includes(PayoutStatus.COMPLETED);
          return { total: isPaidOutQuery ? '1500' : '0' };
        }),
      };
      return qb;
    });

    payoutRepo.find.mockResolvedValue([historicalPayout(1500, 'payout-paid')]);

    const summary = await service.getPayoutSummary('store-1');

    expect(summary.grossRevenue).toBe(5000);
    expect(summary.totalPaidOut).toBe(1500);
    expect(summary.availableBalance).toBe(3255);
    expect(summary.canRequestPayout).toBe(true);
    expect(summary.omise.availableBalance).toBe(3255);
    expect(summary.manual.grossRevenue).toBe(5000);
  });

  it('excludes on_hold item portions from gross revenue eligibility', async () => {
    const qb = createQueryBuilderMock({ total: '3000' });
    orderItemRepo.createQueryBuilder.mockReturnValue(qb);
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const summary = await service.getPayoutSummary('store-1');

    expect(summary.grossRevenue).toBe(3000);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(/fulfillment_status/i),
      expect.objectContaining({ heldFulfillment: 'on_hold' }),
    );
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(/order\.status/i),
      expect.objectContaining({ heldOrderStatus: 'on_hold' }),
    );
  });

  it('includes restored non-held lines in gross revenue after leave-hold', async () => {
    const qb = createQueryBuilderMock({ total: '4500' });
    orderItemRepo.createQueryBuilder.mockReturnValue(qb);
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const summary = await service.getPayoutSummary('store-1');

    expect(summary.grossRevenue).toBe(4500);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringMatching(/fulfillment_status\s*<>\s*:heldFulfillment/i),
      expect.any(Object),
    );
  });

  describe('store-scoped promotion discount deduction (QA-hunt regression)', () => {
    it('deducts the store’s own promotion-usage discounts from gross revenue', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
      payoutRepo.createQueryBuilder
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));
      dataSource.createQueryBuilder.mockImplementation((entity?: { name?: string }) => {
        if (isShippingSliceEntity(entity)) {
          return createQueryBuilderMock({ total: '0' });
        }
        return createQueryBuilderMock({ total: '750' });
      });

      const summary = await service.getPayoutSummary('store-1');

      expect(summary.grossRevenue).toBe(4250);
      expect(summary.availableBalance).toBe(3952.5);
    });

    it('never lets gross revenue go negative even if discounts somehow exceed subtotal', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '100' }));
      payoutRepo.createQueryBuilder
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));
      dataSource.createQueryBuilder.mockImplementation((entity?: { name?: string }) => {
        if (isShippingSliceEntity(entity)) {
          return createQueryBuilderMock({ total: '0' });
        }
        return createQueryBuilderMock({ total: '500' });
      });

      const summary = await service.getPayoutSummary('store-1');

      expect(summary.grossRevenue).toBe(0);
    });

    it('scopes the promotion-usage query to this store and STORE-scoped promotions only', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
      payoutRepo.createQueryBuilder
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));
      const promoQb = createQueryBuilderMock({ total: '0' });
      mockPromoQuery(promoQb);

      await service.getPayoutSummary('store-1');

      expect(promoQb.where).toHaveBeenCalledWith(
        expect.stringMatching(/promotion\.store_id/i),
        expect.objectContaining({ storeId: 'store-1' }),
      );
      expect(promoQb.andWhere).toHaveBeenCalledWith(
        expect.stringMatching(/promotion\.scope/i),
        expect.objectContaining({ scope: 'store' }),
      );
    });

    it('does not deduct platform-scoped promotion discounts from the product base', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
      payoutRepo.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '0' }),
      );
      const promoQb = createQueryBuilderMock({ total: '0' });
      mockPromoQuery(promoQb);

      const summary = await service.getPayoutSummary('store-1');

      expect(summary.grossRevenue).toBe(5000);
      expect(promoQb.andWhere).toHaveBeenCalledWith(
        expect.stringMatching(/promotion\.scope/i),
        expect.objectContaining({ scope: 'store' }),
      );
      expect(promoQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringMatching(/promotion\.scope/i),
        expect.objectContaining({ scope: 'platform' }),
      );
    });

    it('does not join order_items or filter item.fulfillment_status on the promo query', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
      payoutRepo.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '0' }),
      );
      const promoQb = createQueryBuilderMock({ total: '0' });
      mockPromoQuery(promoQb);

      await service.getPayoutSummary('store-1');

      const joinHaystack = promoQb.innerJoin.mock.calls
        .map((call) => JSON.stringify(call))
        .join(' ');
      expect(joinHaystack).not.toMatch(/order_items|OrderItem|fulfillment_status/i);
      expect(promoQb.andWhere).not.toHaveBeenCalledWith(
        expect.stringMatching(/fulfillment_status/i),
        expect.anything(),
      );
    });
  });

  it('allows retry when orphan pending payout exists', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '2050' }));
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '2050' }));
    payoutRepo.findOne.mockResolvedValue({
      id: 'orphan',
      status: PayoutStatus.PENDING,
      transferReference: null,
    });

    const summary = await service.getPayoutSummary('store-1');
    expect(summary.canRequestPayout).toBe(true);
  });

  it('blocks vendor request when balance is below minimum', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '400' }));
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    await expect(service.requestPayout('store-1')).rejects.toThrow(BadRequestException);
  });

  it('requests payout for full available balance when eligible', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
    payoutRepo.find.mockResolvedValue([historicalPayout(1000, 'payout-paid')]);
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '1000' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const payout = await service.requestPayout('store-1', 'vendor-user-1');

    expect(managerPayoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 3720,
        processedBy: 'vendor-user-1',
      }),
    );
    expect(payout.amount).toBe(3720);
  });

  it('allows admin trigger below minimum when bypassing threshold', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '600' }));
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const payout = await service.triggerPayout('store-1', {
      amount: 200,
      bypassMinimum: true,
      processedBy: 'admin-1',
    });

    expect(payout.amount).toBe(200);
  });

  describe('concurrent payout requests (QA-hunt: double-payment race condition)', () => {
    it('rejects createManualPayout when a concurrent request already inserted a pending payout inside the lock', async () => {
      // Simulates two racing requestPayout/triggerPayout calls: both pass the outer
      // "no pending payout" pre-check, but by the time this call acquires the store row
      // lock, the other racer's payout has already committed and is visible here.
      managerPayoutRepo.findOne.mockResolvedValue({
        id: 'payout-racer',
        status: PayoutStatus.PENDING,
      });

      await expect(service.createManualPayout('store-1', 1500)).rejects.toMatchObject({
        response: { code: 'PAYOUT_ALREADY_PENDING' },
      });
      expect(managerPayoutRepo.create).not.toHaveBeenCalled();
    });

    it('does not double-submit to Omise when a concurrent call already claimed the same orphan payout', async () => {
      const orphan = {
        id: 'payout-orphan',
        storeId: 'store-1',
        amount: 2050,
        netAmount: 2050,
        status: PayoutStatus.PENDING,
        transferReference: null,
        failureReason: null,
      };
      payoutRepo.findOne
        .mockResolvedValueOnce(orphan) // findOrphanPendingPayout
        .mockResolvedValueOnce({ ...orphan, status: PayoutStatus.PROCESSING }); // post-claim refetch
      // The row lock sees the racer already flipped it to PROCESSING/claimed it first.
      managerPayoutQueryBuilder.getOne.mockResolvedValue(null);
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        omiseRecipientId: 'recp_test_1',
        omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
      });
      omiseService.hasCredentials.mockReturnValue(true);
      omiseService.getRecipient.mockResolvedValue({
        id: 'recp_test_1',
        verified: true,
        active: true,
      });

      const payout = await service.requestPayout('store-1', 'vendor-1');

      expect(omiseService.createTransfer).not.toHaveBeenCalled();
      expect(payout.status).toBe(PayoutStatus.PROCESSING);
    });
  });

  it('rejects trigger amount above available balance', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '1000' }));
    payoutRepo.find.mockResolvedValue([historicalPayout(400, 'payout-paid')]);
    payoutRepo.createQueryBuilder.mockImplementation(() =>
      createQueryBuilderMock({ total: '400' }),
    );

    await expect(
      service.triggerPayout('store-1', { amount: 700, bypassMinimum: true }),
    ).rejects.toMatchObject({
      response: { code: 'INSUFFICIENT_BALANCE' },
    });
    expect(managerPayoutRepo.create).not.toHaveBeenCalled();
  });

  it('requests then settles manual bank-transfer payout without Omise', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '2000' }));
    payoutRepo.createQueryBuilder.mockImplementation(() => createQueryBuilderMock({ total: '0' }));

    const requested = await service.requestManualPayout('store-1', 'vendor-1');
    expect(managerPayoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        storeId: 'store-1',
        amount: 1860,
        fee: 0,
        netAmount: 1860,
        productSold: 2000,
        shippingFees: 0,
        commissionAmount: 140,
        commissionRate: 7,
        settlementRail: 'manual',
        status: PayoutStatus.PENDING,
        processedBy: 'vendor-1',
        notes: 'Vendor requested manual payout',
      }),
    );
    expect(requested.status).toBe(PayoutStatus.PENDING);

    const pendingRow = {
      id: 'payout-manual-1',
      storeId: 'store-1',
      amount: 1860,
      netAmount: 1860,
      fee: 0,
      productSold: 2000,
      shippingFees: 0,
      commissionAmount: 140,
      commissionRate: 7,
      status: PayoutStatus.PENDING,
      settlementRail: 'manual',
      processedBy: 'vendor-1',
      notes: 'Vendor requested manual payout',
    };
    payoutRepo.findOne.mockResolvedValue(pendingRow);
    managerPayoutQueryBuilder.getOne.mockResolvedValue({ ...pendingRow });

    const payout = await service.settleManualPayout('store-1', {
      processedBy: 'admin-1',
      notes: 'Transferred via SCB',
    });

    expect(managerPayoutRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'payout-manual-1',
        status: PayoutStatus.COMPLETED,
        processedBy: 'admin-1',
        notes: 'Transferred via SCB',
        amount: 1860,
        netAmount: 1860,
        fee: 0,
        productSold: 2000,
        shippingFees: 0,
        commissionAmount: 140,
        commissionRate: 7,
      }),
    );
    expect(omiseService.createTransfer).not.toHaveBeenCalled();
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
  });

  it('rejects settle when vendor has not requested manual payout', async () => {
    orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '2000' }));
    payoutRepo.createQueryBuilder.mockImplementation(() => createQueryBuilderMock({ total: '0' }));
    payoutRepo.findOne.mockResolvedValue(null);

    await expect(service.settleManualPayout('store-1', { processedBy: 'admin-1' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a pending manual payout request', async () => {
    const pendingRow = {
      id: 'payout-manual-2',
      storeId: 'store-1',
      amount: 2000,
      netAmount: 2000,
      status: PayoutStatus.PENDING,
      settlementRail: 'manual',
      processedBy: 'vendor-1',
      notes: 'Vendor requested manual payout',
    };
    payoutRepo.findOne.mockResolvedValue(pendingRow);
    managerPayoutQueryBuilder.getOne.mockResolvedValue({ ...pendingRow });

    const payout = await service.rejectManualPayout('store-1', {
      processedBy: 'admin-1',
      notes: 'Bank details incomplete',
    });

    expect(payout.status).toBe(PayoutStatus.FAILED);
    expect(payout.failureReason).toBe('Bank details incomplete');
  });

  describe('available-balance fours identity (AC-016 / AC-D-016)', () => {
    it('returns identity fours on each rail and top-level Omise mirror, including post-cutoff shipping', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      mockCutoffQueries({ preTotal: '0', postTotal: '1000', shipping: '80' });

      const summary = await service.getPayoutSummary('store-1');

      expectFoursIdentity(summary, {
        productSold: 1000,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        availableBalance: 1010,
      });
      expect(summary.manual.productSold).toBe(1000);
      expect(summary.manual.shippingFees).toBe(80);
      expect(summary.manual.commissionAmount).toBe(70);
      expect(summary.manual.commissionRate).toBe(7);
      expect(summary.manual.availableBalance).toBe(1010);
    });

    it('applies default commission to product only and pays all shipping when goLiveAt is unset', async () => {
      mockCutoffQueries({ preTotal: '0', postTotal: '1000', shipping: '80' });

      const summary = await service.getPayoutSummary('store-1');

      expectFoursIdentity(summary, {
        productSold: 1000,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        availableBalance: 1010,
      });
    });

    it('combines mixed-cutoff into one fours set (pre at 0%, shipping paid in full)', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      mockCutoffQueries({ preTotal: '1500', postTotal: '1000', shipping: '80' });

      const summary = await service.getPayoutSummary('store-1');

      expectFoursIdentity(summary, {
        productSold: 2500,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        availableBalance: 2510,
      });
    });

    it('binds paid_at cutoff as Date (>= post, < or NULL pre) without AT TIME ZONE', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      const { itemQbs, promoQbs, shippingQb } = mockCutoffQueries({
        preTotal: '0',
        postTotal: '1000',
        shipping: '80',
      });

      await service.getPayoutSummary('store-1');

      type AndWhereCall = [string, Record<string, unknown>?];
      const allAndWheres: AndWhereCall[] = [
        ...itemQbs.flatMap((qb) => qb.andWhere.mock.calls as AndWhereCall[]),
        ...promoQbs.flatMap((qb) => qb.andWhere.mock.calls as AndWhereCall[]),
        ...(shippingQb.andWhere.mock.calls as AndWhereCall[]),
      ];
      const haystack = allAndWheres.map((call) => JSON.stringify(call)).join('\n');
      expect(haystack).toMatch(/paid_at\s*>=\s*:goLiveAt/i);
      expect(haystack).toMatch(/paid_at\s+IS NULL|paid_at\s*<\s*:goLiveAt/i);
      expect(haystack).not.toMatch(/AT TIME ZONE/i);
      const goLiveBinds = allAndWheres.filter(
        (call) => call[1] && typeof call[1] === 'object' && 'goLiveAt' in call[1],
      );
      expect(goLiveBinds.length).toBeGreaterThan(0);
      for (const call of goLiveBinds) {
        expect(call[1]?.goLiveAt).toBeInstanceOf(Date);
        expect((call[1]?.goLiveAt as Date).getTime()).toBe(GO_LIVE_AT.getTime());
      }
    });

    it('caps store shipping at customer-paid remainder (order.total minus store items), not live option price', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      const { shippingQb } = mockCutoffQueries({
        preTotal: '0',
        postTotal: '1000',
        shipping: '80',
      });

      await service.getPayoutSummary('store-1');

      const selectHaystack = [...shippingQb.select.mock.calls, ...shippingQb.addSelect.mock.calls]
        .map((call) => JSON.stringify(call))
        .join(' ');
      expect(selectHaystack).toMatch(/shipping_fee/i);
      expect(selectHaystack).toMatch(/order\.total/i);
      expect(selectHaystack).toMatch(/LEAST/i);
      expect(selectHaystack).not.toMatch(/store_shipping_options|option\.price/i);

      const andWhereHaystack = shippingQb.andWhere.mock.calls
        .map((call) => JSON.stringify(call))
        .join(' ');
      expect(andWhereHaystack).toMatch(/fulfillment_status/i);
      expect(andWhereHaystack).toMatch(/heldFulfillment/);
    });

    it('requires a non-held eligible line before summing store shipping', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      const { shippingQb } = mockCutoffQueries({
        preTotal: '0',
        postTotal: '1000',
        shipping: '80',
      });

      await service.getPayoutSummary('store-1');

      const andWhereHaystack = shippingQb.andWhere.mock.calls
        .map((call) => JSON.stringify(call))
        .join(' ');
      expect(andWhereHaystack).toMatch(/fulfillment_status\s*<>\s*:heldFulfillment/i);
      expect(andWhereHaystack).toMatch(/"heldFulfillment"\s*:\s*"on_hold"/);
    });
  });

  describe('computeUnpaidBreakdown fail-fast', () => {
    it('throws STORE_NOT_FOUND when the store is missing', async () => {
      storeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.computeUnpaidBreakdown('missing', PayoutSettlementRail.OMISE, [
          PaymentMethod.PROMPTPAY,
        ]),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('rate-change leftover uses current rate (AC-028)', () => {
    it('commissions leftover unpaid post at 5% after a 7→5 change (not lifetime_net − SUM(amount))', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        name: 'Test Store',
        commissionRate: 5,
      });
      mockCutoffQueries({ preTotal: '0', postTotal: '1000', shipping: '0' });
      payoutRepo.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '465' }),
      );
      payoutRepo.find.mockResolvedValue([
        {
          id: 'payout-old',
          amount: 465,
          productSold: 500,
          shippingFees: 0,
          commissionAmount: 35,
          commissionRate: 7,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const summary = await service.getPayoutSummary('store-1');

      // leftover post 500 at current 5% → commission 25, net 475
      expectFoursIdentity(summary, {
        productSold: 500,
        shippingFees: 0,
        commissionAmount: 25,
        commissionRate: 5,
        availableBalance: 475,
      });
      const lifetimeNetMinusPaidOut = 1000 - 70 - 465;
      expect(summary.availableBalance).not.toBe(465);
      expect(summary.availableBalance).not.toBe(lifetimeNetMinusPaidOut);
    });
  });

  describe('prior payout consume order (created_at ASC, id ASC)', () => {
    it('loads prior payouts ordered by createdAt ASC, id ASC', async () => {
      payoutRepo.find.mockResolvedValue([
        historicalPayout(800, 'payout-a'),
        historicalPayout(200, 'payout-b'),
      ]);
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '1500' }));
      payoutRepo.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '1000' }),
      );

      const summary = await service.getPayoutSummary('store-1');

      expect(payoutRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
      );
      expect(summary.availableBalance).toBe(465);
      expect(summary.productSold).toBe(500);
      expect(summary.commissionAmount).toBe(35);
    });
  });

  describe('create-path snapshot (AC-007/008/018, AC-D-011, AC-D-029)', () => {
    it('writes fee===0 and already-net snapshot on both rails for the same unpaid set', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      mockCutoffQueries({ preTotal: '400', postTotal: '1000', shipping: '80' });

      const omise = await service.createOmisePayout('store-1', 1410);
      expect(omise.amount).toBe(1410);
      expect(omise.netAmount).toBe(1410);
      expect(omise.fee).toBe(0);
      expect(omise.productSold).toBe(1400);
      expect(omise.shippingFees).toBe(80);
      expect(omise.commissionAmount).toBe(70);
      expect(omise.commissionRate).toBe(7);

      mockCutoffQueries({ preTotal: '400', postTotal: '1000', shipping: '80' });
      const manual = await service.requestManualPayout('store-1', 'vendor-1');
      expect(manual.amount).toBe(1410);
      expect(manual.netAmount).toBe(1410);
      expect(manual.fee).toBe(0);
      expect(manual.productSold).toBe(1400);
      expect(manual.shippingFees).toBe(80);
      expect(manual.commissionAmount).toBe(70);
      expect(manual.commissionRate).toBe(7);
    });

    it('omits amount to pay full unpaid fours and snapshots a partial consume for an explicit amount', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      mockCutoffQueries({ preTotal: '400', postTotal: '1000', shipping: '80' });
      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      const full = await service.triggerPayout('store-1', { bypassMinimum: true });
      expect(full.amount).toBe(1410);
      expect(full.productSold).toBe(1400);
      expect(full.shippingFees).toBe(80);
      expect(full.commissionAmount).toBe(70);
      expect(full.fee).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Payout snapshot created'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('net=1410'));
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes('partialConsume'))).toBe(
        false,
      );

      mockCutoffQueries({ preTotal: '0', postTotal: '1000', shipping: '0' });
      const partial = await service.triggerPayout('store-1', {
        amount: 200,
        bypassMinimum: true,
      });
      expect(partial.amount).toBe(200);
      expect(partial.netAmount).toBe(200);
      expect(partial.fee).toBe(0);
      expect(partial.productSold - partial.commissionAmount + partial.shippingFees).toBe(200);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('partialConsume=true'));
      logSpy.mockRestore();
    });

    it('rejects createOmisePayout amount <= 0 or above unpaid net without inserting', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'payout.minPayoutAmount') return 500;
        if (key === 'commission.defaultRatePercent') return 7;
        if (key === 'commission.goLiveAt') return GO_LIVE_AT;
        return undefined;
      });
      mockCutoffQueries({ preTotal: '400', postTotal: '1000', shipping: '80' });

      await expect(service.createOmisePayout('store-1', 0)).rejects.toMatchObject({
        response: { code: 'INVALID_PAYOUT_AMOUNT' },
      });
      expect(managerPayoutRepo.create).not.toHaveBeenCalled();

      await expect(service.createManualPayout('store-1', 1410.01)).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_BALANCE' },
      });
      expect(managerPayoutRepo.create).not.toHaveBeenCalled();
    });

    it('logs ERROR and does not insert when commissionAmount fails AC-D-011', async () => {
      const consumeSpy = jest.spyOn(payoutCommissionCalculator, 'consumeToAmount').mockReturnValue({
        productSold: 1500,
        shippingFees: 0,
        commissionAmount: 99,
        commissionRate: 7,
        net: 1401,
      });
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation();

      await expect(service.createOmisePayout('store-1', 1500)).rejects.toMatchObject({
        response: { code: 'COMMISSION_FORMULA_MISMATCH' },
      });
      expect(managerPayoutRepo.create).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Commission formula mismatch'));
      consumeSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('does not rewrite snapshot when retrying an orphan pending payout', async () => {
      const orphan = {
        id: 'payout-orphan',
        storeId: 'store-1',
        amount: 1410,
        netAmount: 1410,
        fee: 0,
        productSold: 1400,
        shippingFees: 80,
        commissionAmount: 70,
        commissionRate: 7,
        status: PayoutStatus.PENDING,
        transferReference: null,
        failureReason: null,
      };
      payoutRepo.findOne.mockResolvedValue(orphan);
      managerPayoutQueryBuilder.getOne.mockResolvedValue({ ...orphan });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        omiseRecipientId: 'recp_test_1',
        omiseRecipientStatus: OmiseRecipientStatus.ACTIVE,
      });
      omiseService.hasCredentials.mockReturnValue(true);
      omiseService.getRecipient.mockResolvedValue({
        id: 'recp_test_1',
        verified: true,
        active: true,
      });
      omiseService.createTransfer.mockResolvedValue({ id: 'trsf_retry_snap', paid: false });

      const payout = await service.requestPayout('store-1', 'vendor-1');

      expect(managerPayoutRepo.create).not.toHaveBeenCalled();
      expect(payout.productSold).toBe(1400);
      expect(payout.commissionAmount).toBe(70);
      expect(payout.amount).toBe(1410);
      expect(omiseService.createTransfer).toHaveBeenCalledWith('recp_test_1', 141000);
    });
  });
});
