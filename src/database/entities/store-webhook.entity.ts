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
import { IsNotEmpty, IsUrl, Length } from 'class-validator';
import { Store } from './store.entity';

/** Full order-automation event set for vendor outbound webhooks. */
export const VENDOR_WEBHOOK_EVENTS = [
  'order.create',
  'order.payment_failed',
  'order.paid',
  'order.processing',
  'order.on_hold',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'order.refunded',
] as const;

export type VendorWebhookEvent = (typeof VENDOR_WEBHOOK_EVENTS)[number];

const DEFAULT_EVENTS_JSON = JSON.stringify([...VENDOR_WEBHOOK_EVENTS]);

@Entity('store_webhooks')
@Index(['storeId'], { unique: true })
export class StoreWebhook {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'store_id', type: 'uuid', unique: true })
  @IsNotEmpty()
  storeId!: string;

  @Column({ name: 'url', type: 'varchar', length: 2048 })
  @IsNotEmpty()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @Length(1, 2048)
  url!: string;

  /** Plain signing secret — shown once on create/rotate; used for HMAC-SHA256. */
  @Column({ name: 'secret', type: 'varchar', length: 128 })
  @IsNotEmpty()
  secret!: string;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled!: boolean;

  @Column({
    name: 'events',
    type: 'jsonb',
    default: () => `'${DEFAULT_EVENTS_JSON}'`,
  })
  events!: VendorWebhookEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store!: Store;
}
