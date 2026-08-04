import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsModule } from '../analytics/analytics.module';
import { StoresModule } from '../stores/stores.module';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { SearchModule } from '../search/search.module';
import { ProductsService } from './products.service';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { CartItem } from '../../database/entities/cart-item.entity';
import { ProductsResolver } from './products.resolver';

@Module({
  imports: [
    AnalyticsModule,
    StoresModule,
    TaxonomyModule,
    SearchModule,
    TypeOrmModule.forFeature([Product, ProductVariant, ProductImage, OrderItem, CartItem]),
  ],
  providers: [ProductsService, ProductsResolver],
  exports: [ProductsService],
})
export class ProductsModule {}
