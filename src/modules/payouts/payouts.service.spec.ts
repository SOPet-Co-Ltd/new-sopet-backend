import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OmiseService } from '../omise/omise.service';

function createQueryBuilderMock(result: { total: string }) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(result),
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
  const configService = {
    get: jest.fn((key: string) => (key === 'payout.minPayoutAmount' ? 500 : undefined)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    omiseService.hasCredentials.mockReturnValue(false);
    storeRepo.findOne.mockResolvedValue({ id: 'store-1' });
    payoutRepo.findOne.mockResolvedValue(null);
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
        status: PayoutStatus.PENDING,
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
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '1500' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const summary = await service.getPayoutSummary('store-1');

    expect(summary.grossRevenue).toBe(5000);
    expect(summary.totalPaidOut).toBe(1500);
    expect(summary.availableBalance).toBe(3500);
    expect(summary.canRequestPayout).toBe(true);
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
      dataSource.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '750' }),
      );

      const summary = await service.getPayoutSummary('store-1');

      expect(summary.grossRevenue).toBe(4250);
      expect(summary.availableBalance).toBe(4250);
    });

    it('never lets gross revenue go negative even if discounts somehow exceed subtotal', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '100' }));
      payoutRepo.createQueryBuilder
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));
      dataSource.createQueryBuilder.mockImplementation(() =>
        createQueryBuilderMock({ total: '500' }),
      );

      const summary = await service.getPayoutSummary('store-1');

      expect(summary.grossRevenue).toBe(0);
    });

    it('scopes the promotion-usage query to this store and STORE-scoped promotions only', async () => {
      orderItemRepo.createQueryBuilder.mockReturnValue(createQueryBuilderMock({ total: '5000' }));
      payoutRepo.createQueryBuilder
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }))
        .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));
      const promoQb = createQueryBuilderMock({ total: '0' });
      dataSource.createQueryBuilder.mockImplementation(() => promoQb);

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
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '1000' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    const payout = await service.requestPayout('store-1', 'vendor-user-1');

    expect(managerPayoutRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4000,
        processedBy: 'vendor-user-1',
      }),
    );
    expect(payout.amount).toBe(4000);
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
    payoutRepo.createQueryBuilder
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '400' }))
      .mockImplementationOnce(() => createQueryBuilderMock({ total: '0' }));

    await expect(
      service.triggerPayout('store-1', { amount: 700, bypassMinimum: true }),
    ).rejects.toThrow(BadRequestException);
  });
});
