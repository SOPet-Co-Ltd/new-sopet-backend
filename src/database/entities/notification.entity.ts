import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsEnum } from 'class-validator';
import { Customer } from './customer.entity';

export enum NotificationType {
  ORDER_CONFIRMATION = 'order_confirmation',
  ORDER_SHIPPED = 'order_shipped',
  ORDER_DELIVERED = 'order_delivered',
  PROMOTION = 'promotion',
  REVIEW_REQUEST = 'review_request',
  DISPUTE_UPDATE = 'dispute_update',
}

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

@Entity('notifications')
@Index(['customerId', 'createdAt'])
@Index(['type'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: NotificationType,
  })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @Column({
    name: 'channel',
    type: 'enum',
    enum: NotificationChannel,
  })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @Column({ name: 'subject', type: 'varchar', length: 255, nullable: true })
  subject!: string | null;

  @Column({ name: 'message', type: 'text' })
  @IsNotEmpty()
  message!: string;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, any>;

  @Column({ name: 'is_sent', type: 'boolean', default: false })
  isSent!: boolean;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.notifications)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;
}
