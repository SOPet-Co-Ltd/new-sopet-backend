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
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';
import { Store } from './store.entity';
import { User } from './user.entity';
import { StoreMemberRole } from './store-member.entity';

export enum StoreMemberInvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('store_member_invitations')
@Index(['token'], { unique: true })
@Index(['storeId', 'email'], { unique: true, where: "status = 'pending'" })
export class StoreMemberInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'store_id', type: 'uuid' })
  @IsNotEmpty()
  storeId: string;

  @Column({ name: 'invited_by', type: 'uuid' })
  @IsNotEmpty()
  invitedBy: string;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  @IsEmail()
  email: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: StoreMemberRole,
    default: StoreMemberRole.STAFF,
  })
  @IsEnum(StoreMemberRole)
  role: StoreMemberRole;

  @Column({ name: 'token', type: 'varchar', length: 64 })
  @IsNotEmpty()
  token: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: StoreMemberInvitationStatus,
    default: StoreMemberInvitationStatus.PENDING,
  })
  @IsEnum(StoreMemberInvitationStatus)
  status: StoreMemberInvitationStatus;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => Store, (store) => store.memberInvitations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'store_id' })
  store: Store;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'invited_by' })
  inviter: User;
}
