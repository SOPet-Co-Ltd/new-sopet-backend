import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, IsPhoneNumber } from 'class-validator';
import { Customer } from './customer.entity';
import { OrderItem } from './order-item.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import { PromotionUsage } from './promotion-usage.entity';
import { PayoutItem } from './payout-item.entity';
import { Dispute } from './dispute.entity';
import { Review } from './review.entity';
import { OrderStoreShipping } from './order-store-shipping.entity';
import { OrderShippingAddress } from './order-shipping-address.entity';
import { OrderStatus, PaymentMethod } from './enums/order.enums';

export { OrderStatus, PaymentMethod } from './enums/order.enums';

@Entity('orders')
@Index(['orderNumber'], { unique: true })
@Index(['customerId', 'createdAt'])
@Index(['guestPhone'])
@Index(['status'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_number', type: 'varchar', length: 50 })
  @IsNotEmpty()
  orderNumber: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ name: 'guest_phone', type: 'varchar', length: 20, nullable: true })
  @IsOptional()
  @IsPhoneNumber('TH')
  guestPhone: string | null;

  @Column({ name: 'guest_name', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  guestName: string | null;

  @Column({ name: 'guest_email', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  guestEmail: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING_PAYMENT,
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @Column({ name: 'subtotal', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  subtotal: number;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2, default: 0 })
  @IsNumber()
  @Min(0)
  discountAmount: number;

  @Column({ name: 'shipping_fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  @IsNumber()
  @Min(0)
  shippingFee: number;

  @Column({ name: 'total', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  total: number;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
  })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @Column({ name: 'payment_reference', type: 'varchar', length: 255, nullable: true })
  paymentReference: string | null;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  @IsOptional()
  notes: string | null;

  @Column({ name: 'source_dispute_id', type: 'uuid', nullable: true })
  sourceDisputeId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.orders, {
    nullable: true,
  })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @OneToMany(() => OrderStatusHistory, (history) => history.order)
  statusHistory: OrderStatusHistory[];

  @OneToMany(() => PromotionUsage, (usage) => usage.order)
  promotionUsages: PromotionUsage[];

  @OneToMany(() => PayoutItem, (item) => item.order)
  payoutItems: PayoutItem[];

  @OneToMany(() => Dispute, (dispute) => dispute.order)
  disputes: Dispute[];

  @OneToMany(() => Review, (review) => review.order)
  reviews: Review[];

  @OneToMany(() => OrderStoreShipping, (shipping) => shipping.order, {
    cascade: true,
  })
  storeShippings: OrderStoreShipping[];

  @OneToOne(() => OrderShippingAddress, (address) => address.order, {
    cascade: true,
  })
  shippingAddress: OrderShippingAddress;
}
