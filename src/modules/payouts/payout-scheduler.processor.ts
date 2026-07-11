import { Processor, WorkerHost } from '@nestjs/bullmq';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { PAYOUT_SCHEDULER_QUEUE } from './payout-scheduler.constants';

@Processor(PAYOUT_SCHEDULER_QUEUE, { concurrency: 1 })
export class PayoutSchedulerProcessor extends WorkerHost {
  constructor(private readonly payoutSchedulerService: PayoutSchedulerService) {
    super();
  }

  async process(): Promise<void> {
    await this.payoutSchedulerService.runScheduledPayouts();
  }
}
