import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { IsEmail, IsNotEmpty } from 'class-validator';

@Entity('email_verification_tokens')
@Index(['token'], { unique: true })
@Index(['email'])
export class EmailVerificationToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'email', type: 'varchar', length: 255 })
  @IsEmail()
  email: string;

  @Column({ name: 'token', type: 'varchar', length: 64 })
  @IsNotEmpty()
  token: string;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
