import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { IsNotEmpty, Length } from 'class-validator';
import { StoreShippingOption } from './store-shipping-option.entity';

@Entity('shipping_providers')
export class ShippingProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @OneToMany(() => StoreShippingOption, (option) => option.provider)
  shippingOptions: StoreShippingOption[];
}
