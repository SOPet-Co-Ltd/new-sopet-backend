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
import { IsNotEmpty, IsOptional, IsEnum, Length } from 'class-validator';
import { User } from './user.entity';
import { StoreMember } from './store-member.entity';
import { Product } from './product.entity';
import { Promotion } from './promotion.entity';
import { StoreShippingOption } from './store-shipping-option.entity';
import { StoreMemberInvitation } from './store-member-invitation.entity';

export enum StoreStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

export enum PayoutSchedule {
  MANUAL = 'manual',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  BIWEEKLY = 'biweekly',
  MONTHLY = 'monthly',
}

export enum OmiseRecipientStatus {
  NOT_CONNECTED = 'not_connected',
  PENDING = 'pending',
  ACTIVE = 'active',
  FAILED = 'failed',
}

@Entity('stores')
@Index(['slug'], { unique: true, where: 'deleted_at IS NULL' })
@Index(['status'])
@Index(['ownerId'])
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @Column({ name: 'slug', type: 'varchar', length: 255 })
  @IsNotEmpty()
  @Length(1, 255)
  slug!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  @IsOptional()
  description!: string | null;

  @Column({ name: 'logo_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  logoUrl!: string | null;

  @Column({ name: 'banner_url', type: 'varchar', length: 500, nullable: true })
  @IsOptional()
  bannerUrl!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StoreStatus,
    default: StoreStatus.PENDING,
  })
  @IsEnum(StoreStatus)
  status!: StoreStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy!: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  @IsOptional()
  rejectionReason!: string | null;

  @Column({
    name: 'contact_phone',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  @IsOptional()
  contactPhone!: string | null;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @IsOptional()
  contactEmail!: string | null;

  @Column({ name: 'address', type: 'text', nullable: true })
  @IsOptional()
  address!: string | null;

  @Column({ name: 'bank_account_name', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  bankAccountName!: string | null;

  @Column({ name: 'bank_account_number', type: 'varchar', length: 50, nullable: true })
  @IsOptional()
  bankAccountNumber!: string | null;

  @Column({ name: 'bank_name', type: 'varchar', length: 100, nullable: true })
  @IsOptional()
  bankName!: string | null;

  @Column({ name: 'bank_code', type: 'varchar', length: 20, nullable: true })
  @IsOptional()
  bankCode!: string | null;

  @Column({
    name: 'omise_recipient_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  @IsOptional()
  omiseRecipientId!: string | null;

  @Column({
    name: 'omise_recipient_status',
    type: 'enum',
    enum: OmiseRecipientStatus,
    enumName: 'store_omise_recipient_status_enum',
    default: OmiseRecipientStatus.NOT_CONNECTED,
  })
  omiseRecipientStatus!: OmiseRecipientStatus;

  @Column({
    name: 'omise_recipient_failure_message',
    type: 'text',
    nullable: true,
  })
  @IsOptional()
  omiseRecipientFailureMessage!: string | null;

  @Column({
    name: 'payout_schedule',
    type: 'enum',
    enum: PayoutSchedule,
    default: PayoutSchedule.MANUAL,
  })
  payoutSchedule!: PayoutSchedule;

  @Column({ name: 'payout_schedule_paused', type: 'boolean', default: false })
  payoutSchedulePaused!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt!: Date | null;

  // Relations
  @ManyToOne(() => User, (user) => user.ownedStores)
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @OneToMany(() => StoreMember, (member) => member.store)
  members!: StoreMember[];

  @OneToMany(() => Product, (product) => product.store)
  products!: Product[];

  @OneToMany(() => Promotion, (promotion) => promotion.store)
  promotions!: Promotion[];

  @OneToMany(() => StoreShippingOption, (option) => option.store)
  shippingOptions!: StoreShippingOption[];

  @OneToMany(() => StoreMemberInvitation, (invitation) => invitation.store)
  memberInvitations!: StoreMemberInvitation[];
}
