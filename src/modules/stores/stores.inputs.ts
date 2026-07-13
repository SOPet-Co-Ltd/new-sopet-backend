import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateIf,
} from 'class-validator';

@InputType()
export class RegisterVendorInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  fullName: string;
}

@InputType()
export class SubmitStoreRequestInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  storeName: string;

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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

@InputType()
export class RejectStoreRequestInput {
  @Field()
  @IsUUID()
  id: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  reason: string;
}

@InputType()
export class SubmitStoreReactivationRequestInput {
  @Field()
  @IsUUID()
  storeId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  title: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  content: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  mediaUrls?: string[];
}

@InputType()
export class RejectStoreReactivationRequestInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

@InputType()
export class InviteVendorInput {
  @Field()
  @IsEmail()
  email: string;
}

@InputType()
export class AcceptVendorInvitationInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  token: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  password: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  fullName: string;
}

@InputType()
export class UpdateStoreAsAdminInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  ownerId?: string | null;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  status?: string;
}

@InputType()
export class CreateStoreAsAdminInput {
  @Field()
  @IsUUID()
  ownerUserId: string;

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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  bannerUrl?: string;
}

@InputType()
export class UpdateVendorAsAdminInput {
  @Field()
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fullName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
