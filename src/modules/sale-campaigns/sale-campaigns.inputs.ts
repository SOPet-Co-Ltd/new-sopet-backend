import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType()
export class SaleCampaignItemInput {
  @Field()
  @IsUUID()
  productId!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  variantId?: string | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(99)
  discountPercent?: number | null;
}

@InputType()
export class CreateSaleCampaignInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  priority?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @Field(() => [SaleCampaignItemInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleCampaignItemInput)
  items!: SaleCampaignItemInput[];
}

@InputType()
export class UpdateSaleCampaignInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  priority?: number;

  @Field(() => [SaleCampaignItemInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleCampaignItemInput)
  items?: SaleCampaignItemInput[];
}
