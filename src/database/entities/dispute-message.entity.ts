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
import { Dispute } from './dispute.entity';

export enum DisputeMessageSender {
  CUSTOMER = 'customer',
  VENDOR = 'vendor',
  ADMIN = 'admin',
}

@Entity('dispute_messages')
@Index(['disputeId', 'createdAt'])
export class DisputeMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'dispute_id', type: 'uuid' })
  @IsNotEmpty()
  disputeId!: string;

  @Column({
    name: 'sender_type',
    type: 'enum',
    enum: DisputeMessageSender,
  })
  @IsEnum(DisputeMessageSender)
  senderType!: DisputeMessageSender;

  @Column({ name: 'sender_id', type: 'uuid' })
  @IsNotEmpty()
  senderId!: string;

  @Column({ name: 'message', type: 'text' })
  @IsNotEmpty()
  message!: string;

  @Column({ name: 'attachments', type: 'text', array: true, default: [] })
  attachments!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Dispute, (dispute) => dispute.messages)
  @JoinColumn({ name: 'dispute_id' })
  dispute!: Dispute;
}
