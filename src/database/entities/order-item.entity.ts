import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsNumber, Min, IsEnum } from 'class-validator';
import { Order } from './order.entity';
import { Store } from './store.entity';
import { ProductVariant } from './product-variant.entity';

export enum FulfillmentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

@Entity('order_items')
@Index(['orderId'])
@Index(['storeId', 'fulfillmentStatus', 'createdAt'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  @IsNotEmpty()
  variantId: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  productName: string;

  @Column({ name: 'variant_options', type: 'jsonb', default: {} })
  variantOptions: Record<string, string>;

  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  unitPrice: number;

  @Column({ name: 'quantity', type: 'integer' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @Column({ name: 'subtotal', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  subtotal: number;

  @Column({
    name: 'fulfillment_status',
    type: 'enum',
    enum: FulfillmentStatus,
    default: FulfillmentStatus.PENDING,
  })
  @IsEnum(FulfillmentStatus)
  fulfillmentStatus: FulfillmentStatus;

  @Column({ name: 'tracking_number', type: 'varchar', length: 100, nullable: true })
  trackingNumber: string | null;

  @Column({ name: 'shipped_at', type: 'timestamp', nullable: true })
  shippedAt: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => ProductVariant, (variant) => variant.orderItems)
  @JoinColumn({ name: 'variant_id' })
  productVariant: ProductVariant;
}
