import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsModule } from '../products/products.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { StoresModule } from '../stores/stores.module';
import { OrdersModule } from '../orders/orders.module';
import { VendorWebhooksModule } from '../vendor-webhooks/vendor-webhooks.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { PublicApiController } from './public-api.controller';
import { ImportDataService } from './import-data.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, SavedAddress, Order, Product, ProductVariant]),
    ProductsModule,
    ApiKeysModule,
    StoresModule,
    OrdersModule,
    VendorWebhooksModule,
    ReviewsModule,
    AnalyticsModule,
  ],
  controllers: [PublicApiController],
  providers: [ImportDataService],
})
export class PublicApiModule {}
