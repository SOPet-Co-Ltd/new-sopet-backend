import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, Length } from 'class-validator';
import { Store } from './store.entity';
import { PromotionUsage } from './promotion-usage.entity';

export enum PromotionType {
  PERCENTAGE = 'percentage',
  FIXED_AMOUNT = 'fixed_amount',
  FREE_SHIPPING = 'free_shipping',
  BUY_X_GET_Y = 'buy_x_get_y',
  FIXED_SHIPPING_DISCOUNT = 'fixed_shipping_discount',
  PERCENTAGE_SHIPPING_DISCOUNT = 'percentage_shipping_discount',
}

export enum PromotionScope {
  PLATFORM = 'platform',
  STORE = 'store',
}

@Entity('promotions')
@Index(['code'], { unique: true, where: 'deleted_at IS NULL' })
@Index(['storeId', 'isActive'])
@Index(['scope', 'isActive'])
export class Promotion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId!: string | null;

  @Column({ name: 'code', type: 'varchar', length: 50 })
  @IsNotEmpty()
  @Length(1, 50)
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description!: string | null;

  @Column({
    name: 'type',
    type: 'enum',
    enum: PromotionType,
  })
  @IsEnum(PromotionType)
  type!: PromotionType;

  @Column({
    name: 'scope',
    type: 'enum',
    enum: PromotionScope,
    default: PromotionScope.STORE,
  })
  @IsEnum(PromotionScope)
  scope!: PromotionScope;

  @Column({ name: 'discount_value', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  discountValue!: number;

  @Column({ name: 'min_purchase_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  minPurchaseAmount!: number | null;

  @Column({ name: 'max_discount_amount', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  maxDiscountAmount!: number | null;

  @Column({ name: 'usage_limit', type: 'integer', nullable: true })
  @IsOptional()
  @IsNumber()
  usageLimit!: number | null;

  @Column({ name: 'usage_per_customer', type: 'integer', default: 1 })
  @IsNumber()
  @Min(0)
  usagePerCustomer!: number;

  @Column({ name: 'usage_count', type: 'integer', default: 0 })
  @IsNumber()
  usageCount!: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'auto_apply', type: 'boolean', default: false })
  autoApply!: boolean;

  @Column({ name: 'priority', type: 'integer', default: 0 })
  priority!: number;

  @Column({ name: 'conditions', type: 'jsonb', default: {} })
  conditions!: Record<string, unknown>;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  // Relations
  @ManyToOne(() => Store, (store) => store.promotions, { nullable: true })
  @JoinColumn({ name: 'store_id' })
  store!: Store | null;

  @OneToMany(() => PromotionUsage, (usage) => usage.promotion)
  usages!: PromotionUsage[];
}
