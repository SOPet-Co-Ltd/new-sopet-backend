import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';
import { OmiseModule } from '../omise/omise.module';
import payoutConfig from '../../config/payout.config';
import { Payout } from '../../database/entities/payout.entity';
import { Store } from '../../database/entities/store.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { PayoutsService } from './payouts.service';
import { PayoutsResolver } from './payouts.resolver';
import { PayoutSchedulerService } from './payout-scheduler.service';
import { PayoutSchedulerProcessor } from './payout-scheduler.processor';
import { PAYOUT_SCHEDULER_QUEUE } from './payout-scheduler.constants';

const payoutQueueImports = isRedisConfigured()
  ? [
      BullModule.registerQueue({
        name: PAYOUT_SCHEDULER_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: true,
        },
      }),
    ]
  : [];

const payoutQueueProviders = isRedisConfigured() ? [PayoutSchedulerProcessor] : [];

@Module({
  imports: [
    OmiseModule,
    ConfigModule.forFeature(payoutConfig),
    ...payoutQueueImports,
    TypeOrmModule.forFeature([Payout, Store, OrderItem]),
  ],
  providers: [PayoutsService, PayoutsResolver, PayoutSchedulerService, ...payoutQueueProviders],
  exports: [PayoutsService],
})
export class PayoutsModule {}
