import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
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

@Module({
  imports: [
    OmiseModule,
    ConfigModule.forFeature(payoutConfig),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host'),
          port: configService.get<number>('redis.port'),
          password: configService.get<string>('redis.password'),
          db: configService.get<number>('redis.db'),
        },
      }),
      inject: [ConfigService],
    }),
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
    TypeOrmModule.forFeature([Payout, Store, OrderItem]),
  ],
  providers: [PayoutsService, PayoutsResolver, PayoutSchedulerService, PayoutSchedulerProcessor],
  exports: [PayoutsService],
})
export class PayoutsModule {}
