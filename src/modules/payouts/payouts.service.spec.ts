import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { Store } from '../../database/entities/store.entity';
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
    createQueryBuilder: jest.fn(),
  };
  const storeRepo = {
    findOne: jest.fn(),
  };
  const orderItemRepo = {
    createQueryBuilder: jest.fn(),
  };
  const omiseService = {
    hasCredentials: jest.fn().mockReturnValue(false),
    createTransfer: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => (key === 'payout.minPayoutAmount' ? 500 : undefined)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    omiseService.hasCredentials.mockReturnValue(false);
    storeRepo.findOne.mockResolvedValue({ id: 'store-1' });
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
      omiseRecipientStatus: 'active',
    });
    omiseService.hasCredentials.mockReturnValue(true);
    omiseService.createTransfer.mockResolvedValue({ id: 'trsf_test_1' });

    const payout = await service.createManualPayout('store-1', 1500);

    expect(omiseService.createTransfer).toHaveBeenCalledWith('recp_test_1', 150000);
    expect(payout.transferReference).toBe('trsf_test_1');
    expect(payout.status).toBe(PayoutStatus.PROCESSING);
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
