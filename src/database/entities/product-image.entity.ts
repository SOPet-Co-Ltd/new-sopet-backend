import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsBoolean, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Product } from './product.entity';

@Entity('product_images')
@Index(['productId', 'sortOrder'])
export class ProductImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'product_id', type: 'uuid' })
  @IsNotEmpty()
  productId!: string;

  @Column({ name: 'url', type: 'varchar', length: 500 })
  @IsNotEmpty()
  url!: string;

  @Column({ name: 'alt_text', type: 'varchar', length: 255, nullable: true })
  altText!: string | null;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  @IsNumber()
  @Min(0)
  sortOrder!: number;

  @Column({ name: 'is_thumbnail', type: 'boolean', default: false })
  @IsBoolean()
  isThumbnail!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  // Relations
  @ManyToOne(() => Product, (product) => product.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;
}
