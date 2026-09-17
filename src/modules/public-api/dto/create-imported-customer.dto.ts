import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateImportedCustomerDto {
  @ApiProperty({ example: '+66812345678' })
  @IsPhoneNumber('TH')
  phone!: string;

  @ApiProperty({ example: 'สมชาย ใจดี' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;

  @ApiPropertyOptional({ example: 'somchai@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ description: 'Partner ERP customer id', example: 'ERP-C-1001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalId?: string;
}

export class CreateImportedAddressDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fullName!: string;

  @ApiProperty({ example: '+66812345678' })
  @IsPhoneNumber('TH')
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  addressLine1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tumbon?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  amphoe!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  district!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province!: string;

  @ApiProperty({ example: '10110' })
  @IsString()
  @Length(1, 10)
  postalCode!: string;

  @ApiPropertyOptional({ example: 'บ้าน' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;
}
