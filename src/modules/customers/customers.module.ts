import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { CustomersService } from './customers.service';
import { CustomersResolver } from './customers.resolver';
import { StoresModule } from '../stores/stores.module';
import { OrdersModule } from '../orders/orders.module';
import { CustomerRepository } from '../../database/repositories/customer.repository';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, OrderItem]), StoresModule, OrdersModule],
  providers: [CustomersService, CustomersResolver, CustomerRepository],
  exports: [CustomersService],
})
export class CustomersModule {}
