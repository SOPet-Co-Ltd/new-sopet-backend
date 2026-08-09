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
  ON_HOLD = 'on_hold',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

@Entity('order_items')
@Index(['orderId'])
@Index(['storeId', 'fulfillmentStatus', 'createdAt'])
@Index(['fulfillmentStatus', 'holdStartedAt'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  @IsNotEmpty()
  variantId!: string;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  productName!: string;

  @Column({ name: 'variant_options', type: 'jsonb', default: {} })
  variantOptions!: Record<string, string>;

  @Column({ name: 'unit_price', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  /** Catalog sell price at order create (before campaign %); defaults to unitPrice for legacy rows. */
  @Column({ name: 'catalog_unit_price', type: 'decimal', precision: 10, scale: 2, nullable: true })
  catalogUnitPrice!: number | null;

  @Column({ name: 'sale_campaign_id', type: 'uuid', nullable: true })
  saleCampaignId!: string | null;

  @Column({ name: 'sale_discount_percent', type: 'decimal', precision: 5, scale: 2, nullable: true })
  saleDiscountPercent!: number | null;

  @Column({ name: 'quantity', type: 'integer' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @Column({ name: 'subtotal', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  subtotal!: number;

  @Column({
    name: 'fulfillment_status',
    type: 'enum',
    enum: FulfillmentStatus,
    default: FulfillmentStatus.PENDING,
  })
  @IsEnum(FulfillmentStatus)
  fulfillmentStatus!: FulfillmentStatus;

  @Column({
    name: 'previous_fulfillment_status',
    type: 'enum',
    enum: FulfillmentStatus,
    nullable: true,
  })
  previousFulfillmentStatus!: FulfillmentStatus | null;

  @Column({ name: 'hold_started_at', type: 'timestamptz', nullable: true })
  holdStartedAt!: Date | null;

  @Column({ name: 'tracking_number', type: 'varchar', length: 100, nullable: true })
  trackingNumber!: string | null;

  @Column({ name: 'fulfillment_provider', type: 'varchar', length: 100, nullable: true })
  fulfillmentProvider!: string | null;

  @Column({ name: 'tracking_url', type: 'varchar', length: 2048, nullable: true })
  trackingUrl!: string | null;

  @Column({ name: 'shipped_at', type: 'timestamp', nullable: true })
  shippedAt!: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamp', nullable: true })
  deliveredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @ManyToOne(() => ProductVariant, (variant) => variant.orderItems)
  @JoinColumn({ name: 'variant_id' })
  productVariant!: ProductVariant;
}
