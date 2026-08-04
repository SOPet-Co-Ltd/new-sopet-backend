import { IsNotEmpty, IsString, IsOptional, Length, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAddressDto {
  @ApiProperty({
    description: 'Label for the address',
    example: 'Home',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  label!: string;

  @ApiProperty({
    description: 'Name of the recipient',
    example: 'Somchai Jaidee',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  recipientName!: string;

  @ApiProperty({
    description: 'Phone number of the recipient (local format)',
    example: '0812345678',
    minLength: 1,
    maxLength: 20,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 20)
  recipientPhone!: string;

  @ApiProperty({
    description: 'Primary address line',
    example: '123 Sukhumvit Road',
  })
  @IsNotEmpty()
  @IsString()
  addressLine1!: string;

  @ApiPropertyOptional({
    description: 'Secondary address line',
    example: 'Unit 4B',
  })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({
    description: 'Sub-district (tambon)',
    example: 'Khlong Toei',
  })
  @IsOptional()
  @IsString()
  tumbon?: string;

  @ApiProperty({
    description: 'District (amphoe)',
    example: 'Khlong Toei',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  amphoe!: string;

  @ApiPropertyOptional({
    description: 'Deprecated alias for amphoe',
    example: 'Khlong Toei',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @ApiProperty({
    description: 'Province',
    example: 'Bangkok',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  province!: string;

  @ApiProperty({
    description: 'Postal code',
    example: '10110',
    minLength: 5,
    maxLength: 10,
  })
  @IsNotEmpty()
  @IsString()
  @Length(5, 10)
  postalCode!: string;

  @ApiPropertyOptional({
    description: 'Whether this is the default address',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional({
    description: 'Label for the address',
    example: 'Home',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  label?: string;

  @ApiPropertyOptional({
    description: 'Name of the recipient',
    example: 'Somchai Jaidee',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  recipientName?: string;

  @ApiPropertyOptional({
    description: 'Phone number of the recipient (local format)',
    example: '0812345678',
    minLength: 1,
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  recipientPhone?: string;

  @ApiPropertyOptional({
    description: 'Primary address line',
    example: '123 Sukhumvit Road',
  })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional({
    description: 'Secondary address line',
    example: 'Unit 4B',
  })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({
    description: 'Sub-district (tambon)',
    example: 'Khlong Toei',
  })
  @IsOptional()
  @IsString()
  tumbon?: string;

  @ApiPropertyOptional({
    description: 'District (amphoe)',
    example: 'Khlong Toei',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  amphoe?: string;

  @ApiPropertyOptional({
    description: 'Deprecated alias for amphoe',
    example: 'Khlong Toei',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @ApiPropertyOptional({
    description: 'Province',
    example: 'Bangkok',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  province?: string;

  @ApiPropertyOptional({
    description: 'Postal code',
    example: '10110',
    minLength: 5,
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @Length(5, 10)
  postalCode?: string;

  @ApiPropertyOptional({
    description: 'Whether this is the default address',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
