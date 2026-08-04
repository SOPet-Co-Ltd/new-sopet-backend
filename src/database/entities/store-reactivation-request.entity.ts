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
import { IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { User } from './user.entity';
import { Store } from './store.entity';
import { StoreReactivationRequestImage } from './store-reactivation-request-image.entity';

export enum StoreReactivationRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('store_reactivation_requests')
@Index(['storeId'])
@Index(['status'])
@Index(['submittedByUserId'])
export class StoreReactivationRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'submitted_by_user_id', type: 'uuid' })
  @IsNotEmpty()
  submittedByUserId!: string;

  @Column({ name: 'title', type: 'varchar', length: 255 })
  @IsNotEmpty()
  title!: string;

  @Column({ name: 'content', type: 'text' })
  @IsNotEmpty()
  content!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StoreReactivationRequestStatus,
    default: StoreReactivationRequestStatus.PENDING,
  })
  @IsEnum(StoreReactivationRequestStatus)
  status!: StoreReactivationRequestStatus;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  @IsOptional()
  reviewNote!: string | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'submitted_by_user_id' })
  submittedBy!: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer!: User | null;

  @OneToMany(() => StoreReactivationRequestImage, (image) => image.request, { cascade: true })
  images!: StoreReactivationRequestImage[];
}
