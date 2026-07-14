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
import { IsOptional } from 'class-validator';
import { Customer } from './customer.entity';
import { CartItem } from './cart-item.entity';

@Entity('carts')
@Index(['customerId'], { unique: true, where: 'customer_id IS NOT NULL' })
@Index(['sessionId'], { unique: true, where: 'session_id IS NOT NULL' })
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId!: string | null;

  @Column({ name: 'session_id', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  sessionId!: string | null;

  @Column({ name: 'merged_at', type: 'timestamp', nullable: true })
  mergedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.carts, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @OneToMany(() => CartItem, (item) => item.cart, { cascade: true })
  items!: CartItem[];
}
