import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsNumber, IsOptional, Length, Min } from 'class-validator';
import { Store } from './store.entity';
import { OrderStoreShipping } from './order-store-shipping.entity';
import { ShippingProvider } from './shipping-provider.entity';

@Entity('store_shipping_options')
@Index(['storeId', 'isActive'])
export class StoreShippingOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description: string | null;

  @Column({ name: 'price', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  price: number;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  @ManyToOne(() => Store, (store) => store.shippingOptions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => ShippingProvider, (provider) => provider.shippingOptions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'provider_id' })
  provider: ShippingProvider | null;

  @OneToMany(() => OrderStoreShipping, (oss) => oss.shippingOption)
  orderShipments: OrderStoreShipping[];
}
