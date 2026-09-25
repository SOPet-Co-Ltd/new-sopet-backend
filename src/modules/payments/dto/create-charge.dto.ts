import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEnum,
  Min,
  IsOptional,
  IsUUID,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PAYMENT_METHODS = [
  'promptpay',
  'credit_card',
  'cod',
  'bank_transfer',
  'truemoney',
  'shopeepay',
] as const;

export class CreateChargeDto {
  @ApiProperty({
    description: 'ID of the order to charge',
    example: 'c5d3e4f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f',
  })
  @IsNotEmpty()
  @IsString()
  orderId!: string;

  @ApiProperty({
    description: 'Amount to charge in the smallest currency unit expected by the provider',
    example: 700,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount!: number;

  @ApiProperty({
    description: 'Payment method used for the charge',
    enum: PAYMENT_METHODS,
    example: 'credit_card',
  })
  @IsNotEmpty()
  @IsEnum(PAYMENT_METHODS)
  paymentMethod!: (typeof PAYMENT_METHODS)[number];

  @ApiProperty({
    description: 'ISO 4217 currency code',
    example: 'THB',
    default: 'THB',
  })
  @IsString()
  @IsNotEmpty()
  currency: string = 'THB';

  @ApiProperty({ required: false, description: 'Omise card token from client' })
  @IsOptional()
  @IsString()
  omiseToken?: string;

  @ApiProperty({ required: false, description: 'Saved payment method ID' })
  @IsOptional()
  @IsUUID()
  savedPaymentMethodId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiProperty({ required: false, description: 'Guest pay token from createOrder (SOPET-H-07)' })
  @IsOptional()
  @IsString()
  guestPayToken?: string;

  @ApiPropertyOptional({
    description: 'Omise jumpapp platform_type hint (IOS / ANDROID / WEB)',
    enum: ['IOS', 'ANDROID', 'WEB'],
  })
  @IsOptional()
  @IsIn(['IOS', 'ANDROID', 'WEB'])
  platformType?: 'IOS' | 'ANDROID' | 'WEB';
}
