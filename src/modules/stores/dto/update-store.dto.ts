import { IsOptional, IsString, IsEmail, Length } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateStoreDto {
  @ApiPropertyOptional({
    description: 'Store display name',
    example: 'Happy Paws Pet Shop',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Store description',
    example: 'Premium pet food and accessories for cats and dogs.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'URL of the store logo image',
    example: 'https://cdn.sopet.co/stores/logo.png',
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({
    description: 'URL of the store banner image',
    example: 'https://cdn.sopet.co/stores/banner.png',
  })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @ApiPropertyOptional({
    description: 'Public contact phone number',
    example: '+66812345678',
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

  @ApiPropertyOptional({
    description: 'Omise bank brand code for the payout recipient',
    example: 'kbank',
  })
  @IsOptional()
  @IsString()
  bankCode?: string;
}
