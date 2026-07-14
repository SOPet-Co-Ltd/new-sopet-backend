import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { IsNotEmpty } from 'class-validator';
import { StoreReactivationRequest } from './store-reactivation-request.entity';

@Entity('store_reactivation_request_images')
@Index(['requestId', 'sortOrder'])
export class StoreReactivationRequestImage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500 })
  @IsNotEmpty()
  imageUrl!: string;

  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @ManyToOne(() => StoreReactivationRequest, (request) => request.images, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request!: StoreReactivationRequest;
}
