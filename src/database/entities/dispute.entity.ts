import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { Customer } from './customer.entity';
import { Order } from './order.entity';
import { DisputeMessage } from './dispute-message.entity';
import { DisputeImage } from './dispute-image.entity';

export enum DisputeStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum DisputeResolution {
  REFUNDED = 'refunded',
  REPLACED = 'replaced',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export enum DisputeIssueType {
  NOT_RECEIVED = 'not_received',
  WRONG_ITEM = 'wrong_item',
  DAMAGED = 'damaged',
  OTHER = 'other',
}

@Entity('disputes')
@Index(['orderId'])
@Index(['customerId', 'status'])
@Index(['status'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId: string;

  @Column({ name: 'reason', type: 'text' })
  @IsNotEmpty()
  reason: string;

  @Column({
    name: 'issue_type',
    type: 'enum',
    enum: DisputeIssueType,
    default: DisputeIssueType.OTHER,
  })
  @IsEnum(DisputeIssueType)
  issueType: DisputeIssueType;

  @Column({
    name: 'status',
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.OPEN,
  })
  @IsEnum(DisputeStatus)
  status: DisputeStatus;

  @Column({
    name: 'resolution',
    type: 'enum',
    enum: DisputeResolution,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(DisputeResolution)
  resolution: DisputeResolution | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  @IsOptional()
  resolutionNotes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Order, (order) => order.disputes)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => Customer, (customer) => customer.disputes)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @OneToMany(() => DisputeMessage, (message) => message.dispute)
  messages: DisputeMessage[];

  @OneToMany(() => DisputeImage, (image) => image.dispute, { cascade: true })
  images: DisputeImage[];
}
