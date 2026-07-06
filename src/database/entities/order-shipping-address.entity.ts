import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { IsNotEmpty, IsOptional, Length } from 'class-validator';
import { Order } from './order.entity';
import { SavedAddress } from './saved-address.entity';

@Entity('order_shipping_addresses')
export class OrderShippingAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid', unique: true })
  orderId: string;

  @Column({ name: 'saved_address_id', type: 'uuid', nullable: true })
  savedAddressId: string | null;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  fullName: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  @IsNotEmpty()
  phone: string;

  @Column({ name: 'address_line1', type: 'text' })
  @IsNotEmpty()
  addressLine1: string;

  @Column({ name: 'address_line2', type: 'text', nullable: true })
  @IsOptional()
  addressLine2: string | null;

  @Column({ name: 'tumbon', type: 'varchar', length: 100, nullable: true })
  @IsOptional()
  tumbon: string | null;

  @Column({ name: 'amphoe', type: 'varchar', length: 100 })
  @IsNotEmpty()
  amphoe: string;

  @Column({ name: 'province', type: 'varchar', length: 100 })
  @IsNotEmpty()
  province: string;

  @Column({ name: 'postal_code', type: 'varchar', length: 10 })
  @IsNotEmpty()
  postalCode: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @OneToOne(() => Order, (order) => order.shippingAddress)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => SavedAddress, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'saved_address_id' })
  savedAddress: SavedAddress | null;
}
