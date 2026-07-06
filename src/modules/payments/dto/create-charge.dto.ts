import { IsNotEmpty, IsString, IsNumber, IsEnum, Min, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChargeDto {
  @ApiProperty({
    description: 'ID of the order to charge',
    example: 'c5d3e4f6-7a8b-9c0d-1e2f-3a4b5c6d7e8f',
  })
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @ApiProperty({
    description: 'Amount to charge in the smallest currency unit expected by the provider',
    example: 700,
    minimum: 0,
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({
    description: 'Payment method used for the charge',
    enum: ['promptpay', 'credit_card', 'cod'],
    example: 'credit_card',
  })
  @IsNotEmpty()
  @IsEnum(['promptpay', 'credit_card', 'cod'])
  paymentMethod: 'promptpay' | 'credit_card' | 'cod';

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
}
