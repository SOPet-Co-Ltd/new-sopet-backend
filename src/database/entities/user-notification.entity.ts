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
import { User } from './user.entity';
import { NotificationChannel } from './notification.entity';

@Entity('user_notifications')
@Index(['userId', 'createdAt'])
@Index(['userId', 'isRead'])
export class UserNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'type', type: 'varchar', length: 50 })
  @IsNotEmpty()
  type!: string;

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
  metadata!: Record<string, unknown>;

  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead!: boolean;

  @Column({ name: 'is_sent', type: 'boolean', default: false })
  isSent!: boolean;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
