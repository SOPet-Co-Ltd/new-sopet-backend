import { DynamicModule, Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';

@Global()
@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    if (!isRedisConfigured()) {
      return { module: QueueModule };
    }

    return {
      module: QueueModule,
      imports: [
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
      ],
      exports: [BullModule],
    };
  }
}
