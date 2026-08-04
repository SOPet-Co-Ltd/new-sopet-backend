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
import { IsNotEmpty, IsOptional, IsPhoneNumber, Length } from 'class-validator';
import { Customer } from './customer.entity';

@Entity('saved_addresses')
@Index(['customerId', 'isDefault'])
export class SavedAddress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  @IsNotEmpty()
  customerId!: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  fullName!: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  @IsNotEmpty()
  @IsPhoneNumber('TH')
  phone!: string;

  @Column({ name: 'address_line1', type: 'text' })
  @IsNotEmpty()
  addressLine1!: string;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  @IsOptional()
  addressLine2!: string | null;

  @Column({ name: 'tumbon', type: 'varchar', length: 100, nullable: true })
  @IsOptional()
  tumbon!: string | null;

  @Column({ name: 'amphoe', type: 'varchar', length: 100 })
  @IsNotEmpty()
  amphoe!: string;

  @Column({ name: 'district', type: 'varchar', length: 100 })
  @IsNotEmpty()
  district!: string;

  @Column({ name: 'province', type: 'varchar', length: 100 })
  @IsNotEmpty()
  province!: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 10 })
  @IsNotEmpty()
  postalCode!: string;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'label', type: 'varchar', length: 50, nullable: true })
  @IsOptional()
  label!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  // Relations
  @ManyToOne(() => Customer, (customer) => customer.savedAddresses)
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;
}
