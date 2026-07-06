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
import { IsNotEmpty, Length } from 'class-validator';
import { Store } from './store.entity';
import { User } from './user.entity';

@Entity('store_api_keys')
@Index(['storeId'])
@Index(['keyPrefix'])
export class StoreApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @Column({ name: 'key_prefix', type: 'varchar', length: 24 })
  @IsNotEmpty()
  @Length(24, 24)
  keyPrefix: string;

  @Column({ name: 'key_hash', type: 'varchar' })
  @IsNotEmpty()
  keyHash: string;

  @Column({ name: 'created_by', type: 'uuid' })
  @IsNotEmpty()
  createdBy: string;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: User;
}
