import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsEnum, IsNumber } from 'class-validator';
import { ProductVariant } from './product-variant.entity';

export enum InventoryTransactionType {
  PURCHASE = 'purchase',
  SALE = 'sale',
  ADJUSTMENT = 'adjustment',
  RETURN = 'return',
  DAMAGED = 'damaged',
}

@Entity('inventory_transactions')
@Index(['variantId', 'createdAt'])
@Index(['type'])
export class InventoryTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  @IsNotEmpty()
  variantId!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: InventoryTransactionType,
  })
  @IsEnum(InventoryTransactionType)
  type!: InventoryTransactionType;

  @Column({ name: 'quantity_change', type: 'integer' })
  @IsNumber()
  quantityChange!: number; // Positive for additions, negative for subtractions

  @Column({ name: 'quantity_after', type: 'integer' })
  @IsNumber()
  quantityAfter!: number;

  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId!: string | null; // Order ID, return ID, etc.

  @Column({ name: 'reference_type', type: 'varchar', length: 50, nullable: true })
  referenceType!: string | null; // 'order', 'return', 'manual', etc.

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'performed_by', type: 'uuid', nullable: true })
  performedBy!: string | null; // User ID who made the change

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => ProductVariant, (variant) => variant.inventoryTransactions)
  @JoinColumn({ name: 'variant_id' })
  productVariant!: ProductVariant;
}
