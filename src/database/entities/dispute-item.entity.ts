import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty } from 'class-validator';
import { Dispute } from './dispute.entity';
import { OrderItem } from './order-item.entity';

@Entity('dispute_items')
@Index(['disputeId'])
@Index(['orderItemId'])
export class DisputeItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dispute_id', type: 'uuid' })
  @IsNotEmpty()
  disputeId: string;

  @Column({ name: 'order_item_id', type: 'uuid' })
  @IsNotEmpty()
  orderItemId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @ManyToOne(() => Dispute, (dispute) => dispute.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dispute_id' })
  dispute: Dispute;

  @ManyToOne(() => OrderItem)
  @JoinColumn({ name: 'order_item_id' })
  orderItem: OrderItem;
}
