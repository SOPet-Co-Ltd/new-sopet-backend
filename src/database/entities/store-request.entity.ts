import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { User } from './user.entity';
import { Store } from './store.entity';

export enum StoreRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('store_requests')
@Index(['vendorUserId'])
@Index(['status'])
export class StoreRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'vendor_user_id', type: 'uuid' })
  @IsNotEmpty()
  vendorUserId!: string;

  @Column({ name: 'store_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  storeName!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description!: string | null;

  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true })
  @IsOptional()
  contactPhone!: string | null;

  @Column({ name: 'contact_email', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  contactEmail!: string | null;

  @Column({ name: 'address', type: 'text', nullable: true })
  @IsOptional()
  address!: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  logoUrl!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StoreRequestStatus,
    default: StoreRequestStatus.PENDING,
  })
  @IsEnum(StoreRequestStatus)
  status!: StoreRequestStatus;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  @IsOptional()
  rejectionReason!: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: 'created_store_id', type: 'uuid', nullable: true })
  createdStoreId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'vendor_user_id' })
  vendorUser!: User;

  @ManyToOne(() => Store, { nullable: true })
  @JoinColumn({ name: 'created_store_id' })
  createdStore!: Store | null;
}
