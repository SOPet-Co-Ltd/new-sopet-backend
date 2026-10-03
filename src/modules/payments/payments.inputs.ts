import { Field, Float, InputType } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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
  omiseToken?: string;

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
}
