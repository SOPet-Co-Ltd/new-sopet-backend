import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { IsPhoneNumber, IsOptional, Length } from 'class-validator';
import { Order } from './order.entity';
import { Review } from './review.entity';
import { Dispute } from './dispute.entity';
import { SavedAddress } from './saved-address.entity';
import { SavedPaymentMethod } from './saved-payment-method.entity';
import { Cart } from './cart.entity';
import { Notification } from './notification.entity';
import { Favorite } from './favorite.entity';

@Entity('customers')
@Index(['phone'], { unique: true, where: 'deleted_at IS NULL' })
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phone', type: 'varchar', length: 20 })
  @IsPhoneNumber('TH')
  phone: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  @Length(1, 255)
  fullName: string | null;

  @Column({ name: 'email', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  email: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  @IsOptional()
  dateOfBirth: string | null;

  @Column({ name: 'profile_photo_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  profilePhotoUrl: string | null;

  @Column({ name: 'is_verified', type: 'boolean', default: false })
  isVerified: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'deletion_requested_at', type: 'timestamp', nullable: true })
  deletionRequestedAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Relations
  @OneToMany(() => Order, (order) => order.customer)
  orders: Order[];

  @OneToMany(() => Review, (review) => review.customer)
  reviews: Review[];

  @OneToMany(() => Dispute, (dispute) => dispute.customer)
  disputes: Dispute[];

  @OneToMany(() => SavedAddress, (address) => address.customer)
  savedAddresses: SavedAddress[];

  @OneToMany(() => SavedPaymentMethod, (method) => method.customer)
  savedPaymentMethods: SavedPaymentMethod[];

  @OneToMany(() => Cart, (cart) => cart.customer)
  carts: Cart[];

  @OneToMany(() => Notification, (notification) => notification.customer)
  notifications: Notification[];

  @OneToMany(() => Favorite, (favorite) => favorite.customer)
  favorites: Favorite[];
}
