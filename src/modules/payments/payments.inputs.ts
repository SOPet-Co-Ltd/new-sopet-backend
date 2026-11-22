import { Field, Float, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsIn,
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
export class SaveCardOnPaymentInput {
  /** RSA-OAEP ciphertext (`rsa:v1:...`) of `{ cardholderName, pan, expiryMonth, expiryYear }`. */
  @Field()
  @IsNotEmpty()
  @IsString()
  cardCipher!: string;

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

  /** RSA-OAEP ciphertext (`rsa:v1:...`) of the CVV. Never persisted. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  cardSecurityCodeCipher?: string;

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
