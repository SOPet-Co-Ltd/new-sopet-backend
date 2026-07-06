import { IsNotEmpty, IsString, IsNumber, IsOptional, Min, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVariantDto {
  @ApiProperty({
    description: 'Variant display name',
    example: 'Chicken flavour',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiProperty({
    description: 'Stock keeping unit, unique per store',
    example: 'CATFOOD-CHK-2KG',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  sku: string;

  @ApiPropertyOptional({
    description: 'Amount added to (or subtracted from) the base price (THB)',
    example: 50,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceModifier?: number;

  @ApiProperty({
    description: 'Quantity currently in stock',
    example: 120,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  stockQuantity: number;

  @ApiPropertyOptional({
    description: 'Arbitrary variant attributes (e.g. size, color)',
    example: { size: '2kg', flavour: 'chicken' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  attributes?: Record<string, any>;
}

export class UpdateVariantDto {
  @ApiPropertyOptional({
    description: 'Variant display name',
    example: 'Chicken flavour',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Stock keeping unit, unique per store',
    example: 'CATFOOD-CHK-2KG',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sku?: string;

  @ApiPropertyOptional({
    description: 'Amount added to (or subtracted from) the base price (THB)',
    example: 50,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceModifier?: number;

  @ApiPropertyOptional({
    description: 'Quantity currently in stock',
    example: 120,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @ApiPropertyOptional({
    description: 'Arbitrary variant attributes (e.g. size, color)',
    example: { size: '2kg', flavour: 'chicken' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  attributes?: Record<string, any>;
}
