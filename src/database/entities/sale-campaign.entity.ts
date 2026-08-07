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
import { IsNotEmpty, IsOptional, Length } from 'class-validator';
import { Store } from './store.entity';
import { SaleCampaignItem } from './sale-campaign-item.entity';

/**
 * Timed catalog sale window for strikethrough / % badge display.
 * Distinct from coupon Promotions (checkout discounts).
 */
@Entity('sale_campaigns')
@Index(['storeId', 'isActive'])
@Index(['storeId', 'startsAt', 'expiresAt'])
export class SaleCampaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description!: string | null;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** Higher priority wins when multiple campaigns match the same SKU. */
  @Column({ name: 'priority', type: 'integer', default: 0 })
  priority!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @OneToMany(() => SaleCampaignItem, (item) => item.campaign, { cascade: true })
  items!: SaleCampaignItem[];
}
