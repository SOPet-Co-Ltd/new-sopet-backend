import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { PayoutsService } from './payouts.service';
import { PAYOUT_SCHEDULER_JOB, PAYOUT_SCHEDULER_QUEUE } from './payout-scheduler.constants';
import { Store, PayoutSchedule } from '../../database/entities/store.entity';

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

  /**
   * No-op: all payouts use the manual rail (vendor requests, admin transfers offline).
   * The scheduler no longer creates payouts or transfers.
   */
  async runScheduledPayouts(): Promise<void> {
    this.logger.log('Scheduled payouts skipped — manual settlement rail only');
  }

  isDue(schedule: PayoutSchedule, now: Date): boolean {
    switch (schedule) {
      case PayoutSchedule.DAILY:
        return true;
      case PayoutSchedule.WEEKLY:
        return now.getDay() === 1;
      case PayoutSchedule.BIWEEKLY:
        // Twice a month, on fixed anchor days - not a 1-7/15-21 "window" (which matched
        // every day in those ranges since this cron runs daily, firing ~14 payouts/month
        // instead of 2 once a payout cleared and new balance accrued mid-window).
        return now.getDate() === 1 || now.getDate() === 15;
      case PayoutSchedule.MONTHLY:
        return now.getDate() === 1;
      default:
        return false;
    }
  }
}
