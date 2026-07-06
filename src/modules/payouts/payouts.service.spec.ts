import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { Store } from '../../database/entities/store.entity';
import { OmiseService } from '../omise/omise.service';

describe('PayoutsService', () => {
  let service: PayoutsService;
  const payoutRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ ...x, id: 'payout-1' })),
    find: jest.fn(),
  };
  const storeRepo = {
    findOne: jest.fn(),
  };
  const omiseService = {
    hasCredentials: jest.fn().mockReturnValue(false),
    createTransfer: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    omiseService.hasCredentials.mockReturnValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayoutsService,
        { provide: getRepositoryToken(Payout), useValue: payoutRepo },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: OmiseService, useValue: omiseService },
      ],
    }).compile();

    service = module.get(PayoutsService);
  });

  it('creates manual payout for existing store', async () => {
    storeRepo.findOne.mockResolvedValue({ id: 'store-1' });

    const payout = await service.createManualPayout('store-1', 1500);

    expect(payoutRepo.create).toHaveBeenCalledWith({
      storeId: 'store-1',
      amount: 1500,
      fee: 0,
      netAmount: 1500,
      status: PayoutStatus.PENDING,
    });
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
});
