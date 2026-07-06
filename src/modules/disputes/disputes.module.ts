import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from '../../database/entities/dispute.entity';
import { Order } from '../../database/entities/order.entity';
import { DisputesService } from './disputes.service';
import { DisputesResolver } from './disputes.resolver';

@Module({
  imports: [TypeOrmModule.forFeature([Dispute, Order])],
  providers: [DisputesService, DisputesResolver],
  exports: [DisputesService],
})
export class DisputesModule {}
