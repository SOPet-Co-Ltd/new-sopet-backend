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
import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { SaleCampaign } from './sale-campaign.entity';
import { Product } from './product.entity';
import { ProductVariant } from './product-variant.entity';

/**
 * Timed SKU markdown for a sale campaign.
 * variantId null = applies to every variant of the product (unless a variant-specific row exists).
 * discountPercent (1–99) reduces payable unit price. compareAtPrice is an optional honest
 * reference (must be greater than catalog); it is never invented from percent.
 */
@Entity('sale_campaign_items')
@Index(['campaignId'])
@Index(['productId'])
@Index(['variantId'])
export class SaleCampaignItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'campaign_id', type: 'uuid' })
  @IsNotEmpty()
  campaignId!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  @IsNotEmpty()
  productId!: string;

  @Column({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column({
    name: 'compare_at_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice!: number | null;

  @Column({
    name: 'discount_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPercent!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @ManyToOne(() => SaleCampaign, (campaign) => campaign.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: SaleCampaign;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @ManyToOne(() => ProductVariant, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'variant_id' })
  variant!: ProductVariant | null;
}
