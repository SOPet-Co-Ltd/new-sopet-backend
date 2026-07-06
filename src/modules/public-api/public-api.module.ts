import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { StoresModule } from '../stores/stores.module';
import { PublicApiController } from './public-api.controller';

@Module({
  imports: [ProductsModule, ApiKeysModule, StoresModule],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
