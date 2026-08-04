import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Order } from './order.entity';
import { Store } from './store.entity';
import { StoreShippingOption } from './store-shipping-option.entity';

@Entity('order_store_shippings')
@Index(['orderId', 'storeId'], { unique: true })
export class OrderStoreShipping {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  @IsNotEmpty()
  orderId!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'shipping_option_id', type: 'uuid' })
  @IsNotEmpty()
  shippingOptionId!: string;

  @Column({ name: 'option_name', type: 'varchar', length: 100 })
  optionName!: string;

  @Column({ name: 'shipping_fee', type: 'decimal', precision: 10, scale: 2 })
  @IsNumber()
  @Min(0)
  shippingFee!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => Order, (order) => order.storeShippings, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;

  @ManyToOne(() => StoreShippingOption, (option) => option.orderShipments)
  @JoinColumn({ name: 'shipping_option_id' })
  shippingOption!: StoreShippingOption;
}
