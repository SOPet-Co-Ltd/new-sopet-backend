import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A parent "variant" — an option group / dimension such as "สี" (Color) or
 * "ขนาด" (Size). It only declares the option name and its possible values; it
 * does NOT carry sku/stock/price (those live on the variant items).
 */
export class PublicVariantGroupDto {
  @ApiProperty({
    description: 'Option group name / dimension (ชื่อตัวเลือก), e.g. "สี"',
    example: 'สี',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiProperty({
    description: 'Possible values for this option group (ค่าตัวเลือก)',
    example: ['แดง', 'น้ำเงิน'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  values: string[];
}

/**
 * A child "variant item" — one concrete, purchasable combination that selects a
 * value from each variant group. This is where sku, stock, and price live. Each
 * item maps to one ProductVariant row in the database.
 */
export class PublicVariantItemDto {
  @ApiProperty({
    description: 'Stock keeping unit, unique per store (SKU)',
    example: 'CAT-ORG-2KG-RED-S',
    minLength: 1,
    maxLength: 100,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  sku: string;

  @ApiProperty({
    description: 'Inventory quantity in stock (จำนวนสต็อก)',
    example: 120,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiProperty({
    description: 'Absolute price for this variant item in THB (ราคา)',
    example: 499,
    minimum: 0,
  })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({
    description:
      'Selected option value for each variant group (maps group name → value). Must include every declared variant group.',
    example: { สี: 'แดง', ขนาด: 'S' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsObject()
  options: Record<string, string>;
}

export class CreatePublicProductDto {
  @ApiProperty({
    description: 'Product name (ชื่อสินค้า)',
    example: 'อาหารแมวออร์แกนิค 2kg',
    minLength: 1,
    maxLength: 255,
  })
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

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
      'Category name (ชื่อหมวดหมู่). Must already exist and be approved; matched case-insensitively. Unknown names return 400.',
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
      'Tag names. Each must already exist and be approved; matched case-insensitively. Unknown names return 400.',
    example: ['ออร์แกนิค', 'เกรดพรีเมียม'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
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

  @ApiProperty({
    description:
      'Variant option groups (parent variants). At least one is required. Each declares a dimension and its values, not sku/stock/price.',
    type: [PublicVariantGroupDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PublicVariantGroupDto)
  variants: PublicVariantGroupDto[];

  @ApiProperty({
    description:
      'Variant items (child combinations). At least one is required. Each carries sku/stock/price and selects a value from every variant group.',
    type: [PublicVariantItemDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => PublicVariantItemDto)
  variantItems: PublicVariantItemDto[];
}
