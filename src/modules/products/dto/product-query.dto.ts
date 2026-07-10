import { IsOptional, IsEnum, IsString, IsNumber, Min, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '../../../database/entities/product.entity';

export class ProductQueryDto {
  @ApiPropertyOptional({
    description: 'Full-text search term matched against product name',
    example: 'cat food',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter by store ID',
    example: 'a1b2c3d4-0000-0000-0000-000000000000',
  })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({
    description: 'Filter by category name',
    example: 'Cat Food',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Filter by tag name or slug (matches taxonomy tags or legacy tag labels)',
    example: 'organic',
  })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({
    description: 'Filter by product status',
    enum: ProductStatus,
    example: ProductStatus.PUBLISHED,
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  allStatuses?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by approved pet type IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  petTypeIds?: string[];

  @ApiPropertyOptional({
    description: 'Filter by approved brand IDs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  brandIds?: string[];

  @ApiPropertyOptional({
    description: 'Minimum base price filter (THB)',
    example: 100,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    description: 'Maximum base price filter (THB)',
    example: 1000,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 20,
    minimum: 1,
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Field to sort by',
    example: 'createdAt',
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({
    description: 'Sort direction',
    enum: ['ASC', 'DESC'],
    example: 'DESC',
    default: 'DESC',
  })
  @IsOptional()
  @IsEnum(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @ApiPropertyOptional({
    description: 'Anonymous session identifier for search personalization',
    example: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Optional search context for personalization (recent queries and product views)',
  })
  @IsOptional()
  searchContext?: {
    recentQueries?: string[];
    recentProductIds?: string[];
  };

  @IsOptional()
  @IsString()
  userId?: string;
}
