import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Promotion } from '../../database/entities/promotion.entity';
import { PromotionUsage } from '../../database/entities/promotion-usage.entity';
import { Product } from '../../database/entities/product.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { PromotionsService } from './promotions.service';
import { PromotionsResolver } from './promotions.resolver';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Promotion, PromotionUsage, Product, Customer, Order]),
    StoresModule,
  ],
  providers: [PromotionsService, PromotionsResolver],
  exports: [PromotionsService],
})
export class PromotionsModule {}
