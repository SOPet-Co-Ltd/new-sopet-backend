import {
  IsNotEmpty,
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
  Min,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderItemDto {
  @ApiProperty({
    description: 'ID of the product being ordered',
    example: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiPropertyOptional({
    description: 'ID of the specific product variant, if applicable',
    example: 'b4e2d3c5-6f7a-8b9c-0d1e-2f3a4b5c6d7e',
  })
  @IsOptional()
  @IsString()
  variantId?: string;

  @ApiProperty({
    description: 'Quantity of the item to order',
    example: 2,
    minimum: 1,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({
    description: 'Unit price of the item in THB',
    example: 350,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;
}

export class ShippingAddressDto {
  @ApiProperty({ description: 'Recipient full name', example: 'Somchai Jaidee' })
  @IsNotEmpty()
  @IsString()
  recipientName: string;

  @ApiProperty({ description: 'Recipient phone number', example: '+66812345678' })
  @IsNotEmpty()
  @IsString()
  recipientPhone: string;

  @ApiProperty({
    description: 'Primary address line',
    example: '123 Sukhumvit Rd',
  })
  @IsNotEmpty()
  @IsString()
  addressLine1: string;

  @ApiPropertyOptional({
    description: 'Secondary address line (unit, building, etc.)',
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

  @ApiProperty({ description: 'District (amphoe)', example: 'Khlong Toei' })
  @IsNotEmpty()
  @IsString()
  amphoe: string;

  @ApiPropertyOptional({
    description: 'Deprecated alias for amphoe',
    example: 'Khlong Toei',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ description: 'Province', example: 'Bangkok' })
  @IsNotEmpty()
  @IsString()
  province: string;

  @ApiProperty({ description: 'Postal code', example: '10110' })
  @IsNotEmpty()
  @IsString()
  postalCode: string;
}

export class StoreShippingSelectionDto {
  @IsNotEmpty()
  @IsString()
  storeId: string;

  @IsNotEmpty()
  @IsUUID()
  shippingOptionId: string;
}

export class CreateOrderDto {
  @ApiProperty({
    description: 'Line items included in the order',
    type: () => [OrderItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @ApiPropertyOptional({
    description: 'Saved address ID to snapshot at checkout',
    example: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsUUID()
  savedAddressId?: string;

  @ApiPropertyOptional({
    description: 'Inline shipping destination when not using a saved address',
    type: () => ShippingAddressDto,
  })
  @ValidateIf((dto: CreateOrderDto) => !dto.savedAddressId)
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress?: ShippingAddressDto;

  @ApiPropertyOptional({
    description: 'Optional promotion / discount code',
    example: 'WELCOME10',
  })
  @IsOptional()
  @IsString()
  promotionCode?: string;

  @ApiPropertyOptional({ description: 'Platform-wide promotion code (stackable)' })
  @IsOptional()
  @IsString()
  platformPromotionCode?: string;

  @ApiPropertyOptional({ description: 'Per-store promotion codes (stackable)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storePromotionCodes?: string[];

  @ApiPropertyOptional({ description: 'Per-store shipping selections at checkout' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreShippingSelectionDto)
  storeShipping?: StoreShippingSelectionDto[];

  @ApiPropertyOptional({ description: 'Guest phone (required for guest checkout)' })
  @IsOptional()
  @IsString()
  guestPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guestName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  guestEmail?: string;

  @ApiPropertyOptional({
    description: 'Optional order notes for the vendor',
    example: 'Please deliver after 6pm',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({
    description: 'Payment method for the order',
    enum: ['promptpay', 'credit_card', 'cod'],
    example: 'promptpay',
  })
  @IsNotEmpty()
  @IsString()
  paymentMethod: 'promptpay' | 'credit_card' | 'cod';
}
