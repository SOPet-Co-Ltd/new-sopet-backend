import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getRepositoryToken(Payout), useValue: payoutRepo },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: OmiseService, useValue: omiseService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(PayoutsService);
  });

  it('creates manual payout for existing store', async () => {
    const payout = await service.createManualPayout('store-1', 1500);

    expect(payoutRepo.create).toHaveBeenCalledWith(
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

    expect(payoutRepo.create).toHaveBeenCalledWith(
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
