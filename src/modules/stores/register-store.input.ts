import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Length, MinLength } from 'class-validator';

@InputType()
export class RegisterStoreInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  contactPhone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  address?: string;

  @Field()
  @IsNotEmpty()
  @IsEmail()
  ownerEmail: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  ownerPassword: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  ownerFullName: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bankAccountName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bankName?: string;
}
