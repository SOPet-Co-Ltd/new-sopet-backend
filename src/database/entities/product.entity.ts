import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsOptional, IsEnum, IsNumber, Min, Length } from 'class-validator';
import { Store } from './store.entity';
import { ProductImage } from './product-image.entity';
import { ProductVariant } from './product-variant.entity';
import { Review } from './review.entity';
import { Favorite } from './favorite.entity';
import { Category } from './category.entity';
import { Tag } from './tag.entity';
import { PetType } from './pet-type.entity';
import { Brand } from './brand.entity';

export enum ProductStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('products')
@Index(['storeId', 'slug'], { unique: true, where: 'deleted_at IS NULL' })
@Index(['storeId', 'status'])
@Index(['status'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name: string;

  @Column({ name: 'slug', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  slug: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description: string | null;

  @Column({ name: 'base_price', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  basePrice: number;

  /** Original / compare-at price used to render a strikethrough discount. */
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
  compareAtPrice: number | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.DRAFT,
  })
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  @IsOptional()
  categoryId: string | null;

  @Column({ name: 'pet_type_id', type: 'uuid', nullable: true })
  @IsOptional()
  petTypeId: string | null;

  @Column({ name: 'brand_id', type: 'uuid', nullable: true })
  @IsOptional()
  brandId: string | null;

  /** Legacy category label kept for backward compatibility. */
  @Column({ name: 'category', type: 'varchar', length: 100, nullable: true })
  @IsOptional()
  category: string | null;

  /** Legacy free-form tags kept for backward compatibility. */
  @Column({ name: 'tags', type: 'text', array: true, default: [] })
  tags: string[];

  @Column({ name: 'warning', type: 'varchar', length: 1000, nullable: true })
  @IsOptional()
  warning: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  @IsOptional()
  expiryDate: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @Column({
    name: 'search_vector',
    type: 'tsvector',
    nullable: true,
    select: false,
  })
  searchVector: string | null;

  @Column({ name: 'average_rating', type: 'decimal', precision: 3, scale: 2, default: 0 })
  averageRating: number;

  @Column({ name: 'review_count', type: 'integer', default: 0 })
  reviewCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => Store, (store) => store.products)
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @OneToMany(() => ProductImage, (image) => image.product, { cascade: true })
  images: ProductImage[];

  @OneToMany(() => ProductVariant, (variant) => variant.product, {
    cascade: true,
  })
  variants: ProductVariant[];

  @OneToMany(() => Review, (review) => review.product)
  reviews: Review[];

  @OneToMany(() => Favorite, (favorite) => favorite.product)
  favorites: Favorite[];

  @ManyToOne(() => Category, (category) => category.products, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  categoryRelation: Category | null;

  @ManyToOne(() => PetType, (petType) => petType.products, { nullable: true })
  @JoinColumn({ name: 'pet_type_id' })
  petTypeRelation: PetType | null;

  @ManyToOne(() => Brand, (brand) => brand.products, { nullable: true })
  @JoinColumn({ name: 'brand_id' })
  brandRelation: Brand | null;

  @ManyToMany(() => Tag, (tag) => tag.products)
  @JoinTable({
    name: 'product_tags',
    joinColumn: { name: 'product_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  taxonomyTags: Tag[];
}
