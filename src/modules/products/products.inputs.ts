import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

@InputType()
export class CreateProductVariantInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  sku: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceModifier?: number;

  @Field(() => Int)
  @IsNumber()
  @Min(0)
  stockQuantity: number;

  @Field(() => String, {
    nullable: true,
    description: 'JSON object of variant attributes (e.g. {"size":"M","color":"Red"})',
  })
  @IsOptional()
  @IsString()
  attributes?: string;
}

@InputType()
export class UpdateProductVariantInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sku?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceModifier?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQuantity?: number;

  @Field(() => String, {
    nullable: true,
    description: 'JSON object of variant attributes (e.g. {"size":"M","color":"Red"})',
  })
  @IsOptional()
  @IsString()
  attributes?: string;
}

@InputType()
export class AddProductImageInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  url: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  altText?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isThumbnail?: boolean;
}

@InputType()
export class UpdateProductImageInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  altText?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isThumbnail?: boolean;
}

@InputType()
export class SyncProductVariantItemInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  id?: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  sku: string;

  @Field(() => Int)
  @IsNumber()
  @Min(0)
  stockQuantity: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  priceModifier?: number;

  @Field(() => String, {
    description: 'JSON object of variant options (e.g. {"color":"red","size":"M"})',
  })
  @IsNotEmpty()
  @IsString()
  attributes: string;
}
