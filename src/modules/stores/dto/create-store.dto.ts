import { IsNotEmpty, IsString, IsEmail, IsOptional, Length, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStoreDto {
  @ApiProperty({
    description: 'Store display name',
    example: 'Happy Paws Pet Shop',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiPropertyOptional({
    description: 'Store description',
    example: 'Premium pet food and accessories for cats and dogs.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Public contact phone number (local format)',
    example: '0812345678',
  })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ApiPropertyOptional({
    description: 'Public contact email',
    example: 'contact@happypaws.co.th',
  })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({
    description: 'Physical store address',
    example: '123 Sukhumvit Rd, Bangkok 10110',
  })
  @IsOptional()
  @IsString()
  address?: string;

  // Owner details (for registration)
  @ApiProperty({
    description: 'Email of the store owner account to create',
    example: 'owner@happypaws.co.th',
  })
  @IsNotEmpty()
  @IsEmail()
  ownerEmail: string;

  @ApiProperty({
    description: 'Password for the store owner account',
    example: 'S3cureP@ss',
    minLength: 6,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  ownerPassword: string;

  @ApiProperty({
    description: 'Full name of the store owner',
    example: 'Somchai Jaidee',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  ownerFullName: string;

  // Bank details
  @ApiPropertyOptional({
    description: 'Bank account holder name for payouts',
    example: 'Somchai Jaidee',
  })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @ApiPropertyOptional({
    description: 'Bank account number for payouts',
    example: '1234567890',
  })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @ApiPropertyOptional({
    description: 'Bank name for payouts',
    example: 'Kasikorn Bank',
  })
  @IsOptional()
  @IsString()
  bankName?: string;
}
