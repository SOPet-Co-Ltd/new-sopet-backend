import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';
import { Order } from '../../database/entities/order.entity';
import { StoreWebhook } from '../../database/entities/store-webhook.entity';
import { VENDOR_WEBHOOK_QUEUE } from './vendor-webhooks.constants';
import { VendorWebhooksProcessor } from './vendor-webhooks.processor';
import { VendorWebhooksService } from './vendor-webhooks.service';

const queueImports = isRedisConfigured()
  ? [
      BullModule.registerQueue({
        name: VENDOR_WEBHOOK_QUEUE,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 3000 },
          removeOnComplete: true,
        },
      }),
    ]
  : [];

const queueProviders = isRedisConfigured() ? [VendorWebhooksProcessor] : [];

@Module({
  imports: [TypeOrmModule.forFeature([StoreWebhook, Order]), ...queueImports],
  providers: [VendorWebhooksService, ...queueProviders],
  exports: [VendorWebhooksService],
})
export class VendorWebhooksModule {}
