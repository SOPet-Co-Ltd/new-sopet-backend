import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsNumber, Min, Max, IsEnum, IsOptional } from 'class-validator';
import { Customer } from './customer.entity';
import { Product } from './product.entity';
import { Order } from './order.entity';
import { ReviewImage } from './review-image.entity';
import { ReviewReply } from './review-reply.entity';

export enum ReviewStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('reviews')
@Index(['productId', 'status'])
@Index(['customerId'])
@Index(['orderId'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_id', type: 'uuid' })
  @IsNotEmpty()
  productId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId: string;

  @Column({ name: 'rating', type: 'integer' })
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @Column({ name: 'comment', type: 'text', nullable: true })
  @IsOptional()
  comment: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ReviewStatus,
    default: ReviewStatus.PENDING,
  })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  moderatedBy: string | null;

  @Column({ name: 'moderated_at', type: 'timestamp', nullable: true })
  moderatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => Product, (product) => product.reviews)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => Customer, (customer) => customer.reviews)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Order, (order) => order.reviews)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @OneToMany(() => ReviewImage, (image) => image.review, { cascade: true })
  images: ReviewImage[];

  @OneToOne(() => ReviewReply, (reply) => reply.review)
  reply: ReviewReply | null;
}
