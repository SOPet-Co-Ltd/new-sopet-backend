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
import { User } from './user.entity';

export enum VendorInvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('vendor_invitations')
@Index(['token'], { unique: true })
@Index(['email'], { unique: true, where: "status = 'pending'" })
export class VendorInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  @IsEmail()
  email: string;

  @Column({ name: 'token', type: 'varchar', length: 64 })
  @IsNotEmpty()
  token: string;

  @Column({ name: 'invited_by', type: 'uuid' })
  @IsNotEmpty()
  invitedBy: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: VendorInvitationStatus,
    default: VendorInvitationStatus.PENDING,
  })
  @IsEnum(VendorInvitationStatus)
  status: VendorInvitationStatus;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'accepted_at', type: 'timestamp', nullable: true })
  acceptedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'invited_by' })
  inviter: User;
}
