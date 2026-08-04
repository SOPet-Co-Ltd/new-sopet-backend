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
import { IsNotEmpty, IsNumber, Min, IsOptional } from 'class-validator';
import { Product } from './product.entity';
import { InventoryTransaction } from './inventory-transaction.entity';
import { OrderItem } from './order-item.entity';
import { CartItem } from './cart-item.entity';

@Entity('product_variants')
@Index(['productId', 'sku'], { unique: true, where: 'deleted_at IS NULL' })
@Index(['sku'])
export class ProductVariant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  @IsNotEmpty()
  productId!: string;

  @Column({ name: 'sku', type: 'varchar', length: 100 })
  @IsNotEmpty()
  sku!: string;

  @Column({ name: 'options', type: 'jsonb', default: {} })
  options!: Record<string, string>; // e.g., { "size": "M", "color": "Red" }

  @Column({
    name: 'price_adjustment',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0,
  })
  @IsNumber()
  priceAdjustment!: number;

  @Column({ name: 'stock_quantity', type: 'integer', default: 0 })
  @IsNumber()
  @Min(0)
  stockQuantity!: number;

  @Column({
    name: 'low_stock_threshold',
    type: 'integer',
    default: 10,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  lowStockThreshold!: number | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  imageUrl!: string | null;

  @Column({ name: 'weight', type: 'decimal', precision: 10, scale: 2, nullable: true })
  @IsOptional()
  @IsNumber()
  weight!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  // Relations
  @ManyToOne(() => Product, (product) => product.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @OneToMany(() => InventoryTransaction, (transaction) => transaction.productVariant)
  inventoryTransactions!: InventoryTransaction[];

  @OneToMany(() => OrderItem, (item) => item.productVariant)
  orderItems!: OrderItem[];

  @OneToMany(() => CartItem, (item) => item.productVariant)
  cartItems!: CartItem[];
}
