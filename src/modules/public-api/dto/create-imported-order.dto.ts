import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateImportedOrderItemDto {
  @ApiProperty({ example: 'อาหารสุนัข 1kg' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productName!: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ minimum: 0, example: 199 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'SOPET product id (preferred for soldCount)' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Store SKU — resolves a variant in this store' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;
}

export class CreateImportedOrderDto {
  @ApiProperty({ example: 'OLD-10042' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  externalOrderNumber!: string;

  @ApiProperty({ example: '2024-06-15T10:00:00.000Z' })
  @IsDateString()
  placedAt!: string;

  @ApiPropertyOptional({ description: 'Imported customer id from POST /imported-customers' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({ example: 50, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  shippingFee?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiProperty({ type: [CreateImportedOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateImportedOrderItemDto)
  items!: CreateImportedOrderItemDto[];
}
