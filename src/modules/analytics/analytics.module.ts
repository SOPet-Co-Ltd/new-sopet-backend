import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Product } from '../../database/entities/product.entity';
import { StoresModule } from '../stores/stores.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsResolver } from './analytics.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Store, StoreRequest, Customer, Product]),
    StoresModule,
  ],
  providers: [AnalyticsService, AnalyticsResolver],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
