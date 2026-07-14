import { Field, Float, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

@InputType()
export class CreatePaymentInput {
  @Field()
  @IsUUID()
  orderId!: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  amount!: number;

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
}
