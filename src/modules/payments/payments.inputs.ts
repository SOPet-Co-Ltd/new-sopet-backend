import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class SaveCardOnPaymentInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  cardToken!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(4, 4)
  lastFour!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  brand!: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  expiryMonth!: number;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  expiryYear!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class CreatePaymentInput {
  @Field()
  @IsUUID()
  orderId!: string;

  /** Ignored by the service — charges use the locked order total. */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @Field({ defaultValue: 'THB' })
  @IsString()
  currency!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  paymentMethod!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  cardToken?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  cardSecurityCode?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  savedPaymentMethodId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  guestPayToken?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['IOS', 'ANDROID', 'WEB'])
  platformType?: 'IOS' | 'ANDROID' | 'WEB';

  /** When set, card is saved only after this payment succeeds (Beam CIT). */
  @Field(() => SaveCardOnPaymentInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => SaveCardOnPaymentInput)
  saveCard?: SaveCardOnPaymentInput;
}
