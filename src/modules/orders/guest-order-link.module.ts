import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../../database/entities/order.entity';
import { GuestOrderLinkService } from './guest-order-link.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  providers: [GuestOrderLinkService],
  exports: [GuestOrderLinkService],
})
export class GuestOrderLinkModule {}
