import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { GuestOrderLinkService } from './guest-order-link.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Customer])],
  providers: [GuestOrderLinkService, CustomerRepository],
  exports: [GuestOrderLinkService],
})
export class GuestOrderLinkModule {}
