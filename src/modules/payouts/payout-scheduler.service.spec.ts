import { PayoutSchedulerService } from './payout-scheduler.service';
import { PayoutSchedule, StoreStatus } from '../../database/entities/store.entity';

describe('PayoutSchedulerService', () => {
  let service: PayoutSchedulerService;
  const payoutsService = { createManualPayout: jest.fn() };
  const configService = {
    get: jest.fn((key: string) => (key.includes('cron') ? '0 2 * * *' : 'Asia/Bangkok')),
  };
  const payoutQueue = {
    getRepeatableJobs: jest.fn().mockResolvedValue([]),
    removeRepeatableByKey: jest.fn(),
    add: jest.fn(),
    close: jest.fn(),
  };
  const storeRepo = { find: jest.fn() };
  const orderItemRepo = { createQueryBuilder: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PayoutSchedulerService(
      payoutsService as never,
      configService as never,
      payoutQueue as never,
      storeRepo as never,
      orderItemRepo as never,
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

    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '2500' }),
    };
    orderItemRepo.createQueryBuilder.mockReturnValue(qb);
    payoutsService.createManualPayout.mockResolvedValue({ id: 'payout-1' });

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).toHaveBeenCalledWith('store-2', 2500);
  });

  it('skips stores with zero balance', async () => {
    storeRepo.find.mockResolvedValue([
      {
        id: 'store-3',
        payoutSchedule: PayoutSchedule.DAILY,
        payoutSchedulePaused: false,
      },
    ]);

    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    };
    orderItemRepo.createQueryBuilder.mockReturnValue(qb);

    await service.runScheduledPayouts();

    expect(payoutsService.createManualPayout).not.toHaveBeenCalled();
  });

  it('registers cron job on module init', async () => {
    await service.onModuleInit();
    expect(payoutQueue.add).toHaveBeenCalled();
  });

  it('evaluates weekly schedule on Monday', () => {
    const monday = new Date('2026-07-06');
    expect(service.isDue(PayoutSchedule.WEEKLY, monday)).toBe(true);
    expect(service.isDue(PayoutSchedule.WEEKLY, new Date('2026-07-07'))).toBe(false);
  });
});
