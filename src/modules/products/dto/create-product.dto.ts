import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Length,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '../../../database/entities/product.entity';

export class CreateProductDto {
  @ApiProperty({
    description: 'Product display name',
    example: 'Organic Cat Food 2kg',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

  @ApiPropertyOptional({
    description: 'Long-form product description',
    example: 'Grain-free organic cat food suitable for all breeds.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Base price in THB (before variant modifiers)',
    example: 499.0,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  basePrice: number;

  @ApiPropertyOptional({
    description: 'Original / compare-at price in THB (for strikethrough discount display)',
    example: 599.0,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiPropertyOptional({
    description: 'Publication status of the product',
    enum: ProductStatus,
    example: ProductStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    description: 'Category name',
    example: 'Cat Food',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @ApiPropertyOptional({
    description: 'Approved global category ID',
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Free-form tags for search and filtering',
    example: ['organic', 'grain-free'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Approved global tag IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @ApiPropertyOptional({
    description: 'Approved global pet type ID',
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  petTypeId?: string;

  @ApiPropertyOptional({
    description: 'Approved global brand ID',
    format: 'uuid',
  })
  @IsOptional()
  @IsString()
  brandId?: string;

  @ApiPropertyOptional({
    description: 'Arbitrary key/value metadata',
    example: { weight: '2kg', brand: 'PurrFect' },
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Warning text (คำเตือน)',
    example: 'Keep refrigerated after opening',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  warning?: string;

  @ApiPropertyOptional({
    description: 'Expiry date (วันหมดอายุ) in YYYY-MM-DD format',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}
