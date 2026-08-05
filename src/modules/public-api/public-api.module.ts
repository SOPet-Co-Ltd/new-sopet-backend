import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { StoresModule } from '../stores/stores.module';
import { OrdersModule } from '../orders/orders.module';
import { VendorWebhooksModule } from '../vendor-webhooks/vendor-webhooks.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { PublicApiController } from './public-api.controller';

@Module({
  imports: [
    ProductsModule,
    ApiKeysModule,
    StoresModule,
    OrdersModule,
    VendorWebhooksModule,
    ReviewsModule,
  ],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
