import { Field, InputType } from '@nestjs/graphql';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

@InputType()
export class RegisterStoreInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  name!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsPhoneNumber('TH')
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
  ownerEmail!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  ownerPassword!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  ownerFullName!: string;

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
