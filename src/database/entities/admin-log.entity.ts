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

export enum AdminAction {
  APPROVE_STORE = 'approve_store',
  REJECT_STORE = 'reject_store',
  SUSPEND_STORE = 'suspend_store',
  APPROVE_REVIEW = 'approve_review',
  REJECT_REVIEW = 'reject_review',
  RESOLVE_DISPUTE = 'resolve_dispute',
  PROCESS_PAYOUT = 'process_payout',
  UPDATE_SETTINGS = 'update_settings',
}

@Entity('admin_logs')
@Index(['adminId', 'createdAt'])
@Index(['action'])
@Index(['entityType', 'entityId'])
export class AdminLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'admin_id', type: 'uuid' })
  @IsNotEmpty()
  adminId!: string;

  @Column({
    name: 'action',
    type: 'enum',
    enum: AdminAction,
  })
  @IsEnum(AdminAction)
  action!: AdminAction;

  @Column({ name: 'entity_type', type: 'varchar', length: 50 })
  @IsNotEmpty()
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  @IsNotEmpty()
  entityId!: string;

  @Column({ name: 'details', type: 'jsonb', default: {} })
  details!: Record<string, any>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.adminLogs)
  @JoinColumn({ name: 'admin_id' })
  admin!: User;
}
