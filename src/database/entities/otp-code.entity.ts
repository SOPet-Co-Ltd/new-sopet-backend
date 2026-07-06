import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { IsPhoneNumber, IsEnum, IsEmail, IsOptional, Length } from 'class-validator';

export enum OtpPurpose {
  LOGIN = 'login',
  VERIFICATION = 'verification',
}

@Entity('otp_codes')
@Index(['phone', 'purpose'])
@Index(['email', 'purpose'])
export class OtpCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  @IsOptional()
  @IsPhoneNumber('TH')
  phone: string | null;

  @Column({ name: 'email', type: 'varchar', length: 255, nullable: true })
  @IsOptional()
  @IsEmail()
  email: string | null;

  @Column({ name: 'code', type: 'varchar', length: 6 })
  @Length(6, 6)
  code: string;

  @Column({
    name: 'purpose',
    type: 'enum',
    enum: OtpPurpose,
    default: OtpPurpose.LOGIN,
  })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
