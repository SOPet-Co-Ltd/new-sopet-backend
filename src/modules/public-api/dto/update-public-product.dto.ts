import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePublicProductDto {
  @ApiPropertyOptional({
    description: 'Product name (ชื่อสินค้า)',
    example: 'อาหารแมวออร์แกนิค 2kg',
    minLength: 1,
    maxLength: 255,
  })
  @IsOptional()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Product description (รายละเอียด)',
    example: 'อาหารแมวเกรดพรีเมียม',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Warning text (คำเตือน)',
    example: 'เก็บในที่แห้ง หลีกเลี่ยงแสงแดด',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  warning?: string;

  @ApiPropertyOptional({
    description: 'Expiry date (วันหมดอายุ) in ISO 8601 date format YYYY-MM-DD',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'expiryDate must be in YYYY-MM-DD format',
  })
  expiryDate?: string;

  @ApiPropertyOptional({
    description:
      'Category name (ชื่อหมวดหมู่). Must already exist and be approved; matched case-insensitively.',
    example: 'อาหารแมว',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @ApiPropertyOptional({
    description:
      'Tag names. Each must already exist and be approved; matched case-insensitively. Replaces the full tag set when sent.',
    example: ['ออร์แกนิค', 'เกรดพรีเมียม'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description:
      'Pet type name (ชื่อประเภทสัตว์เลี้ยง). Must already exist and be approved; matched case-insensitively.',
    example: 'แมว',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  petType?: string;

  @ApiPropertyOptional({
    description:
      'Brand name (ชื่อแบรนด์). Must already exist and be approved; matched case-insensitively.',
    example: 'Royal Canin',
    minLength: 1,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  brand?: string;
}

export class UpdatePublicVariantDto {
  @ApiPropertyOptional({
    description: 'Inventory quantity in stock (จำนวนสต็อก)',
    example: 120,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    description: 'Absolute price for this variant in THB (ราคา)',
    example: 499,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
