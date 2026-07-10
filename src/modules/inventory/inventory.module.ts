import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryService } from './inventory.service';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { InventoryTransaction } from '../../database/entities/inventory-transaction.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderItem, ProductVariant, InventoryTransaction])],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
