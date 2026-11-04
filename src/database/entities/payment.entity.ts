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

  /** Beam PromptPay base64 image payload (preferred over qrCodeUrl for new charges). */
  @Column({ name: 'qr_code_image', type: 'text', nullable: true })
  qrCodeImage!: string | null;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  /** Payment service provider for this charge (`omise` historical, `beam` new). */
  @Column({ name: 'psp', type: 'varchar', length: 20, nullable: true })
  psp!: string | null;

  /** Provider charge id (Beam chargeId for new rows; may mirror omise_charge_id for history). */
  @Column({ name: 'psp_charge_id', type: 'varchar', length: 255, nullable: true })
  pspChargeId!: string | null;

  /** Historical Omise charge id — keep for audit; do not write for new Beam rows. */
  @Column({ name: 'omise_charge_id', type: 'varchar', length: 255, nullable: true })
  omiseChargeId!: string | null;

  /** Beam charge failureCode (e.g. CH_CARD_DECLINED) when status is failed. */
  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode!: string | null;

  /**
   * Pending save-card intent (JSON). Applied in markOrderPaid; cleared after save or on failure.
   * Shape: { cardToken, brand, lastFour, expiryMonth, expiryYear, isDefault? }
   */
  @Column({ name: 'save_card_payload', type: 'text', nullable: true })
  saveCardPayload!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  // Relations
  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order!: Order;
}
