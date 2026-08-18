import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import {
  OrderAuditActorType,
  OrderAuditEventType,
} from '../../modules/order-audit-logs/order-audit-log.constants';

@Entity('order_audit_logs')
@Index('idx_order_audit_logs_order_occurred', ['orderId', 'occurredAt', 'id'])
@Index('idx_order_audit_logs_order_event', ['orderId', 'eventType'])
export class OrderAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  @IsEnum(OrderAuditEventType)
  eventType!: OrderAuditEventType;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  @IsEnum(OrderAuditActorType)
  actorType!: OrderAuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'actor_label', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  actorLabel!: string | null;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId!: string | null;

  @Column({ name: 'details', type: 'jsonb', default: {} })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
