import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoreApiKey } from '../../database/entities/store-api-key.entity';
import { StoresModule } from '../stores/stores.module';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysResolver } from './api-keys.resolver';
import { ApiKeyGuard } from './guards/api-key.guard';
import { ApiKeyRateLimitGuard } from './guards/api-key-rate-limit.guard';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [TypeOrmModule.forFeature([StoreApiKey]), StoresModule, RedisModule],
  providers: [ApiKeysService, ApiKeysResolver, ApiKeyGuard, ApiKeyRateLimitGuard],
  exports: [ApiKeysService, ApiKeyGuard, ApiKeyRateLimitGuard],
})
export class ApiKeysModule {}
