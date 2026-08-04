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
import { Order, PaymentMethod } from './order.entity';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

@Entity('payments')
@Index(['orderId'])
@Index(['status'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'amount', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  amount!: number;

  @Column({ name: 'currency', type: 'varchar', length: 10, default: 'THB' })
  currency!: string;

  @Column({
    name: 'payment_method',
    type: 'enum',
    enum: PaymentMethod,
  })
  paymentMethod!: PaymentMethod;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'pending' })
  status!: PaymentStatus;

  @Column({ name: 'authorize_uri', type: 'varchar', length: 2048, nullable: true })
  authorizeUri!: string | null;

  @Column({ name: 'qr_code_url', type: 'varchar', length: 2048, nullable: true })
  qrCodeUrl!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'omise_charge_id', type: 'varchar', length: 255, nullable: true })
  omiseChargeId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
