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
import { IsEnum, IsNotEmpty } from 'class-validator';
import { User } from './user.entity';
import { Store } from './store.entity';

export enum StoreMemberRole {
  OWNER = 'owner',
  MANAGER = 'manager',
  STAFF = 'staff',
}

@Entity('store_members')
@Index(['userId', 'storeId'], { unique: true })
@Index(['storeId'])
export class StoreMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @IsNotEmpty()
  userId: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: StoreMemberRole,
    default: StoreMemberRole.STAFF,
  })
  @IsEnum(StoreMemberRole)
  role: StoreMemberRole;

  @Column({ name: 'permissions', type: 'jsonb', default: {} })
  permissions: Record<string, boolean>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Store, (store) => store.members)
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => User, (user) => user.storeMembers)
  @JoinColumn({ name: 'user_id' })
  user: User;
}
