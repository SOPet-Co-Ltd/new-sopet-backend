import { IsNotEmpty, IsPhoneNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({
    description: 'Thai phone number to receive the OTP code (local format)',
    example: '0812345678',
  })
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsPhoneNumber('TH', { message: 'Invalid Thai phone number' })
  phone!: string;
}
