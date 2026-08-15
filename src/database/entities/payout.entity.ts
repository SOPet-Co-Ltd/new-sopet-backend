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
import { IsNotEmpty, IsNumber, Min, IsEnum, IsOptional } from 'class-validator';
import { Store } from './store.entity';
import { PayoutItem } from './payout-item.entity';

export enum PayoutStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/** How vendor funds are settled: Omise transfer vs platform bank transfer. */
export enum PayoutSettlementRail {
  OMISE = 'omise',
  MANUAL = 'manual',
}

@Entity('payouts')
@Index(['storeId', 'status', 'createdAt'])
@Index(['status'])
@Index(['storeId', 'settlementRail', 'status'])
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @Column({ name: 'fee', type: 'decimal', precision: 10, scale: 2, default: 0 })
  @IsNumber()
  @Min(0)
  fee!: number;

  @Column({ name: 'net_amount', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  netAmount!: number;

  @Column({ name: 'commission_rate', type: 'integer', nullable: true })
  commissionRate!: number | null;

  @Column({ name: 'product_sold', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  productSold!: number | null;

  @Column({ name: 'shipping_fees', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFees!: number | null;

  @Column({ name: 'commission_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  commissionAmount!: number | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: PayoutStatus,
    default: PayoutStatus.PENDING,
  })
  @IsEnum(PayoutStatus)
  status!: PayoutStatus;

  @Column({
    name: 'settlement_rail',
    type: 'enum',
    enum: PayoutSettlementRail,
    default: PayoutSettlementRail.OMISE,
  })
  @IsEnum(PayoutSettlementRail)
  settlementRail!: PayoutSettlementRail;

  @Column({ name: 'transfer_reference', type: 'varchar', length: 255, nullable: true })
  transferReference!: string | null;

  @Column({ name: 'processed_by', type: 'uuid', nullable: true })
  processedBy!: string | null;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  @IsOptional()
  failureReason!: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  @IsOptional()
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @OneToMany(() => PayoutItem, (item) => item.payout)
  items!: PayoutItem[];
}
