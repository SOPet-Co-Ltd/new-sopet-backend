import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { PromotionType } from '../../database/entities/promotion.entity';

@InputType()
export class ValidatePromotionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  code: string;

  @Field(() => Float)
  subtotal: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

@InputType()
export class CreatePromotionInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 50)
  code: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field()
  @IsEnum(PromotionType)
  type: PromotionType;

  @Field(() => Float)
  @IsNumber()
  @Min(0, { message: 'มูลค่าส่วนลดต้องไม่ต่ำกว่า 0' })
  discountValue: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'ยอดซื้อขั้นต่ำต้องไม่ต่ำกว่า 0' })
  minPurchaseAmount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'ส่วนลดสูงสุดต้องไม่ต่ำกว่า 0' })
  maxDiscountAmount?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'จำกัดการใช้ทั้งหมดต้องไม่ต่ำกว่า 0' })
  usageLimit?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'จำนวนครั้งต่อลูกค้าต้องไม่ต่ำกว่า 0' })
  usagePerCustomer?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  conditions?: string;

  @Field({ nullable: true })
  @IsOptional()
  startsAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  expiresAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

@InputType()
export class UpdatePromotionInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(PromotionType)
  type?: PromotionType;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'มูลค่าส่วนลดต้องไม่ต่ำกว่า 0' })
  discountValue?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'ยอดซื้อขั้นต่ำต้องไม่ต่ำกว่า 0' })
  minPurchaseAmount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'ส่วนลดสูงสุดต้องไม่ต่ำกว่า 0' })
  maxDiscountAmount?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'จำกัดการใช้ทั้งหมดต้องไม่ต่ำกว่า 0' })
  usageLimit?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'จำนวนครั้งต่อลูกค้าต้องไม่ต่ำกว่า 0' })
  usagePerCustomer?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  autoApply?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  conditions?: string;

  @Field({ nullable: true })
  @IsOptional()
  startsAt?: Date;

  @Field({ nullable: true })
  @IsOptional()
  expiresAt?: Date;
}
