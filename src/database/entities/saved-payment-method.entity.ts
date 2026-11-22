import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsEnum, Length } from 'class-validator';
import { Customer } from './customer.entity';

export enum PaymentMethodType {
  CREDIT_CARD = 'credit_card',
  DEBIT_CARD = 'debit_card',
}

@Entity('saved_payment_methods')
@Index(['customerId', 'isDefault'])
export class SavedPaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: PaymentMethodType,
  })
  @IsEnum(PaymentMethodType)
  type!: PaymentMethodType;

  /** Historical Omise card token — keep for soft-deleted rows; stop writing for new. */
  @Column({ name: 'omise_card_token', type: 'varchar', length: 255, nullable: true })
  omiseCardToken!: string | null;

  /** Payment service provider (`omise` historical, `beam` new). */
  @Column({ name: 'psp', type: 'varchar', length: 20, nullable: true })
  psp!: string | null;

  /**
   * Historical Beam/Omise token id. New vaulted cards use ciphertext columns instead;
   * tokens are one-shot and are not reused for charges.
   */
  @Column({ name: 'psp_card_token', type: 'varchar', length: 255, nullable: true })
  pspCardToken!: string | null;

  @Column({ name: 'card_fingerprint', type: 'varchar', length: 255, nullable: true })
  cardFingerprint!: string | null;

  /** AES-256-GCM ciphertext of cardholder name. Decrypt only at charge time. */
  @Column({ name: 'cardholder_name_enc', type: 'text', nullable: true })
  cardholderNameEnc!: string | null;

  /** AES-256-GCM ciphertext of PAN. Decrypt only at charge time. */
  @Column({ name: 'pan_enc', type: 'text', nullable: true })
  panEnc!: string | null;

  /** AES-256-GCM ciphertext of expiry JSON `{month,year}`. Decrypt only at charge time. */
  @Column({ name: 'expiry_enc', type: 'text', nullable: true })
  expiryEnc!: string | null;

  @Column({ name: 'last_four', type: 'varchar', length: 4 })
  @IsNotEmpty()
  @Length(4, 4)
  lastFour!: string;

  @Column({ name: 'brand', type: 'varchar', length: 50 })
  @IsNotEmpty()
  brand!: string;

  @Column({ name: 'expiry_month', type: 'integer' })
  @IsNotEmpty()
  expiryMonth!: number;

  @Column({ name: 'expiry_year', type: 'integer' })
  @IsNotEmpty()
  expiryYear!: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.savedPaymentMethods)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;
}
