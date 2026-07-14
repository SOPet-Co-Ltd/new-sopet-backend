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
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Cart } from './cart.entity';
import { ProductVariant } from './product-variant.entity';

@Entity('cart_items')
@Index(['cartId', 'variantId'], { unique: true })
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cart_id', type: 'uuid' })
  @IsNotEmpty()
  cartId!: string;

  @Column({ name: 'variant_id', type: 'uuid' })
  @IsNotEmpty()
  variantId!: string;

  @Column({ name: 'quantity', type: 'integer' })
  @IsNumber()
  @Min(1)
  quantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart!: Cart;

  @ManyToOne(() => ProductVariant, (variant) => variant.cartItems)
  @JoinColumn({ name: 'variant_id' })
  productVariant!: ProductVariant;
}
