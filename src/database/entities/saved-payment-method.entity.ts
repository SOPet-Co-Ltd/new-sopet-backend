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
  id: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: PaymentMethodType,
  })
  @IsEnum(PaymentMethodType)
  type: PaymentMethodType;

  @Column({ name: 'omise_card_token', type: 'varchar', length: 255 })
  @IsNotEmpty()
  omiseCardToken: string;

  @Column({ name: 'last_four', type: 'varchar', length: 4 })
  @IsNotEmpty()
  @Length(4, 4)
  lastFour: string;

  @Column({ name: 'brand', type: 'varchar', length: 50 })
  @IsNotEmpty()
  brand: string;

  @Column({ name: 'expiry_month', type: 'integer' })
  @IsNotEmpty()
  expiryMonth: number;

  @Column({ name: 'expiry_year', type: 'integer' })
  @IsNotEmpty()
  expiryYear: number;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.savedPaymentMethods)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;
}
