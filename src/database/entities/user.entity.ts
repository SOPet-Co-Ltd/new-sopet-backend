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
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Store } from './store.entity';
import { StoreMember } from './store-member.entity';
import { AdminLog } from './admin-log.entity';

export enum UserRole {
  ADMIN = 'admin',
  VENDOR = 'vendor',
  CUSTOMER = 'customer',
}

@Entity('users')
@Index(['email'], { unique: true, where: 'deleted_at IS NULL' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  @IsNotEmpty()
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  @IsNotEmpty()
  fullName: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: UserRole,
    default: UserRole.VENDOR,
  })
  @IsEnum(UserRole)
  role: UserRole;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ name: 'last_login_at', type: 'timestamp', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt: Date | null;

  // Relations
  @OneToMany(() => Store, (store) => store.owner)
  ownedStores: Store[];

  @OneToMany(() => StoreMember, (member) => member.user)
  storeMembers: StoreMember[];

  @OneToMany(() => AdminLog, (log) => log.admin)
  adminLogs: AdminLog[];
}
