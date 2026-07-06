import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { PAYOUT_SCHEDULER_JOB, PAYOUT_SCHEDULER_QUEUE } from './payout-scheduler.constants';
import { Store, PayoutSchedule, StoreStatus } from '../../database/entities/store.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';

@Injectable()
export class PayoutSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutSchedulerService.name);

  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly configService: ConfigService,
    @InjectQueue(PAYOUT_SCHEDULER_QUEUE)
    private readonly payoutQueue: Queue,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async onModuleInit(): Promise<void> {
    const cronSchedule = this.configService.get<string>('payout.cronSchedule') ?? '0 2 * * *';
    const timezone = this.configService.get<string>('payout.cronTimezone') ?? 'Asia/Bangkok';

    const existing = await this.payoutQueue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === PAYOUT_SCHEDULER_JOB) {
        await this.payoutQueue.removeRepeatableByKey(job.key);
      }
    }

    await this.payoutQueue.add(
      PAYOUT_SCHEDULER_JOB,
      {},
      {
        repeat: {
          pattern: cronSchedule,
          tz: timezone,
        },
        jobId: PAYOUT_SCHEDULER_JOB,
      },
    );

    this.logger.log(`Payout scheduler registered (${cronSchedule}, ${timezone})`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.payoutQueue.close();
  }

  async runScheduledPayouts(): Promise<void> {
    const stores = await this.storeRepository.find({
      where: {
        status: StoreStatus.APPROVED,
        payoutSchedulePaused: false,
      },
    });

    const now = new Date();
    for (const store of stores) {
      if (store.payoutSchedule === PayoutSchedule.MANUAL) {
        continue;
      }

      if (!this.isDue(store.payoutSchedule, now)) {
        continue;
      }

      const balance = await this.calculateStoreBalance(store.id);
      if (balance <= 0) {
        continue;
      }

      try {
        await this.payoutsService.createManualPayout(store.id, balance);
        this.logger.log(`Scheduled payout created for store ${store.id}: ฿${balance}`);
      } catch (err) {
        this.logger.error(`Scheduled payout failed for store ${store.id}`, err);
      }
    }
  }

  isDue(schedule: PayoutSchedule, now: Date): boolean {
    switch (schedule) {
      case PayoutSchedule.DAILY:
        return true;
      case PayoutSchedule.WEEKLY:
        return now.getDay() === 1;
      case PayoutSchedule.BIWEEKLY:
        return now.getDate() <= 7 || (now.getDate() >= 15 && now.getDate() <= 21);
      case PayoutSchedule.MONTHLY:
        return now.getDate() === 1;
      default:
        return false;
    }
  }

  private async calculateStoreBalance(storeId: string): Promise<number> {
    const result = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'order', 'order.id = item.order_id')
      .where('item.store_id = :storeId', { storeId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PAID, OrderStatus.DELIVERED],
      })
      .select('COALESCE(SUM(item.subtotal), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }
}
