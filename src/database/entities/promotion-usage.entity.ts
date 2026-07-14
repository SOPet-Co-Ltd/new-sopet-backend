import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Promotion } from './promotion.entity';
import { Order } from './order.entity';

@Entity('promotion_usages')
@Index(['promotionId', 'orderId'], { unique: true })
@Index(['orderId'])
export class PromotionUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'promotion_id', type: 'uuid' })
  @IsNotEmpty()
  promotionId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'discount_amount', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  discountAmount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Promotion, (promotion) => promotion.usages)
  @JoinColumn({ name: 'promotion_id' })
  promotion!: Promotion;

  @ManyToOne(() => Order, (order) => order.promotionUsages)
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
