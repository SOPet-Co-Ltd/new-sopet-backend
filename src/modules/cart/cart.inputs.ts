import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

@InputType()
export class AddToCartInput {
  @Field()
  @IsUUID()
  variantId!: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

@InputType()
export class UpdateCartItemInput {
  @Field()
  @IsUUID()
  itemId!: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  quantity!: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

@InputType()
export class RemoveCartItemInput {
  @Field()
  @IsUUID()
  itemId!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sessionId?: string;
}
