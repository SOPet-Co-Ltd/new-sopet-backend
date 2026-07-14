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
import { Payout } from './payout.entity';
import { Order } from './order.entity';

@Entity('payout_items')
@Index(['payoutId'])
@Index(['orderId'])
export class PayoutItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'payout_id', type: 'uuid' })
  @IsNotEmpty()
  payoutId!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Payout, (payout) => payout.items)
  @JoinColumn({ name: 'payout_id' })
  payout!: Payout;

  @ManyToOne(() => Order, (order) => order.payoutItems)
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
