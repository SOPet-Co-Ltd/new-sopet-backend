import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { IsEnum, IsNotEmpty } from 'class-validator';

export enum AuditActorType {
  ADMIN = 'admin',
  VENDOR = 'vendor',
  CUSTOMER = 'customer',
  SYSTEM = 'system',
}

@Entity('audit_logs')
@Index(['createdAt'])
@Index(['action'])
@Index(['resourceType', 'resourceId'])
@Index(['actorType', 'actorId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 20 })
  @IsEnum(AuditActorType)
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'actor_label', type: 'varchar', length: 255, nullable: true })
  actorLabel!: string | null;

  @Column({ name: 'action', type: 'varchar', length: 100 })
  @IsNotEmpty()
  action!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 50 })
  @IsNotEmpty()
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata!: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
