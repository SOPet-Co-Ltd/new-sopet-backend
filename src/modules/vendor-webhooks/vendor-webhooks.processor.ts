import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { VENDOR_WEBHOOK_QUEUE, VendorWebhookJobData } from './vendor-webhooks.constants';
import { VendorWebhooksService } from './vendor-webhooks.service';

@Processor(VENDOR_WEBHOOK_QUEUE, { concurrency: 5 })
export class VendorWebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(VendorWebhooksProcessor.name);

  constructor(private readonly vendorWebhooksService: VendorWebhooksService) {
    super();
  }

  async process(job: Job<VendorWebhookJobData>): Promise<void> {
    try {
      await this.vendorWebhooksService.deliverNow(job.data);
    } catch (error) {
      this.logger.warn(
        `Webhook delivery attempt failed delivery=${job.data.deliveryId} store=${job.data.storeId}`,
        error instanceof Error ? error.message : undefined,
      );
      throw error;
    }
  }
}
