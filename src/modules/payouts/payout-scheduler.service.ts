import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { PAYOUT_SCHEDULER_JOB, PAYOUT_SCHEDULER_QUEUE } from './payout-scheduler.constants';
import { Store, PayoutSchedule, StoreStatus } from '../../database/entities/store.entity';

@Injectable()
export class PayoutSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PayoutSchedulerService.name);

  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly configService: ConfigService,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @Optional()
    @InjectQueue(PAYOUT_SCHEDULER_QUEUE)
    private readonly payoutQueue?: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.payoutQueue) {
      this.logger.warn('Redis not configured — payout scheduler disabled');
      return;
    }

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
    await this.payoutQueue?.close();
  }

  async runScheduledPayouts(): Promise<void> {
    const stores = await this.storeRepository.find({
      where: {
        status: StoreStatus.APPROVED,
        payoutSchedulePaused: false,
      },
    });

    const minimumPayoutAmount = this.configService.get<number>('payout.minPayoutAmount') ?? 500;
    const now = new Date();

    for (const store of stores) {
      if (store.payoutSchedule === PayoutSchedule.MANUAL) {
        continue;
      }

      if (!this.isDue(store.payoutSchedule, now)) {
        continue;
      }

      try {
        const summary = await this.payoutsService.getPayoutSummary(store.id);
        if (summary.availableBalance < minimumPayoutAmount) {
          continue;
        }

        if (summary.pendingPayoutAmount > 0) {
          continue;
        }

        await this.payoutsService.createManualPayout(store.id, summary.availableBalance, {
          notes: 'Scheduled payout',
        });
        this.logger.log(
          `Scheduled payout created for store ${store.id}: ฿${summary.availableBalance}`,
        );
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
}
