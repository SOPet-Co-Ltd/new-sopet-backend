import { IsNotEmpty, IsPhoneNumber, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Thai phone number the OTP was sent to (local format)',
    example: '0812345678',
  })
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsPhoneNumber('TH', { message: 'Invalid Thai phone number' })
  phone!: string;

  @ApiProperty({
    description: '6-digit OTP code received via SMS',
    example: '123456',
    minLength: 6,
    maxLength: 6,
  })
  @IsNotEmpty({ message: 'OTP code is required' })
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  code!: string;
}
