import { PayoutSchedulerService } from './payout-scheduler.service';
import { PayoutSchedule, StoreStatus } from '../../database/entities/store.entity';

describe('PayoutSchedulerService', () => {
  let service: PayoutSchedulerService;
  const payoutsService = {
    getPayoutSummary: jest.fn(),
    createManualPayout: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key.includes('cronSchedule')) return '0 2 * * *';
      if (key.includes('cronTimezone')) return 'Asia/Bangkok';
      if (key === 'payout.minPayoutAmount') return 500;
      return undefined;
    }),
  };
  const payoutQueue = {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn(),
    add: jest.fn(),
    close: jest.fn(),
  };
  const storeRepo = { find: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PayoutSchedulerService(
      payoutsService as never,
      configService as never,
      storeRepo as never,
      payoutQueue as never,
    );
  });

  it('skips manual payout schedule stores', async () => {
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-1',
        payoutSchedule: PayoutSchedule.MANUAL,
        payoutSchedulePaused: false,
      },
    ]);

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).not.toHaveBeenCalled();
  });

  it('creates payout for daily schedule with positive balance', async () => {
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-2',
        status: StoreStatus.APPROVED,
        payoutSchedule: PayoutSchedule.DAILY,
        payoutSchedulePaused: false,
      },
    ]);

    payoutsService.getPayoutSummary.mockResolvedValue({
      availableBalance: 2500,
      pendingPayoutAmount: 0,
    });
    payoutsService.createManualPayout.mockResolvedValue({ id: 'payout-1' });

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).toHaveBeenCalledWith('store-2', 2500, {
      notes: 'Scheduled payout',
    });
  });

  it('skips stores with balance below minimum', async () => {
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-3',
        payoutSchedule: PayoutSchedule.DAILY,
        payoutSchedulePaused: false,
      },
    ]);

    payoutsService.getPayoutSummary.mockResolvedValue({
      availableBalance: 100,
      pendingPayoutAmount: 0,
    });

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).not.toHaveBeenCalled();
  });

  it('skips stores with pending payouts', async () => {
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-4',
        payoutSchedule: PayoutSchedule.DAILY,
        payoutSchedulePaused: false,
      },
    ]);

    payoutsService.getPayoutSummary.mockResolvedValue({
      availableBalance: 2500,
      pendingPayoutAmount: 500,
    });

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).not.toHaveBeenCalled();
  });

  it('registers cron job on module init', async () => {
    await service.onModuleInit();
    expect(payoutQueue.add).toHaveBeenCalled();
  });

  it('skips cron registration when queue is unavailable', async () => {
    const serviceWithoutQueue = new PayoutSchedulerService(
      payoutsService as never,
      configService as never,
      storeRepo as never,
    );

    await serviceWithoutQueue.onModuleInit();

    expect(payoutQueue.add).not.toHaveBeenCalled();
  });

  it('evaluates weekly schedule on Monday', () => {
    const monday = new Date('2026-07-06');
    expect(service.isDue(PayoutSchedule.WEEKLY, monday)).toBe(true);
    expect(service.isDue(PayoutSchedule.WEEKLY, new Date('2026-07-07'))).toBe(false);
  });
});
