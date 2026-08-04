import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { Favorite } from '../../database/entities/favorite.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Review } from '../../database/entities/review.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { CustomersService } from './customers.service';
import { CustomersResolver } from './customers.resolver';
import { StoresModule } from '../stores/stores.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomerRepository } from '../../database/repositories/customer.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Order, OrderItem, SavedAddress, Favorite, Review]),
    StoresModule,
    OrdersModule,
  ],
  providers: [CustomersService, CustomersResolver, CustomerRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
