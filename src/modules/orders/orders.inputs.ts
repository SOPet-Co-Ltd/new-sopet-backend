import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class OrderItemInput {
  @Field()
  @IsString()
  productId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  variantId?: string;

  @Field(() => Int)
  @IsNumber()
  @Min(1)
  quantity: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  price: number;
}

@InputType()
export class ShippingAddressInput {
  @Field()
  @IsString()
  recipientName: string;

  @Field()
  @IsString()
  recipientPhone: string;

  @Field()
  @IsString()
  addressLine1: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  tumbon?: string;

  @Field()
  @IsString()
  amphoe: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  @Field()
  @IsString()
  province: string;

  @Field()
  @IsString()
  postalCode: string;
}

@InputType()
export class StoreShippingSelectionInput {
  @Field()
  @IsString()
  storeId: string;

  @Field()
  @IsUUID()
  shippingOptionId: string;
}

@InputType()
export class CreateOrderInput {
  @Field(() => [OrderItemInput])
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemInput)
  items: OrderItemInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  savedAddressId?: string;

  @Field(() => ShippingAddressInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShippingAddressInput)
  shippingAddress?: ShippingAddressInput;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  promotionCode?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  platformPromotionCode?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storePromotionCodes?: string[];

  @Field(() => [StoreShippingSelectionInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreShippingSelectionInput)
  storeShipping?: StoreShippingSelectionInput[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  guestPhone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  guestName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  guestEmail?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  paymentMethod: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  cartItemIds?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

@InputType()
export class UpdateOrderStatusInput {
  @Field()
  @IsUUID()
  orderId: string;

  @Field()
  @IsString()
  status: string;
}

@InputType()
export class ShipVendorOrderInput {
  @Field()
  @IsUUID()
  orderId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  trackingNumber: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  fulfillmentProvider: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  trackingUrl?: string | null;
}

@InputType()
export class ConfirmOrderDeliveredInput {
  @Field()
  @IsUUID()
  orderId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  guestPhone?: string;
}
