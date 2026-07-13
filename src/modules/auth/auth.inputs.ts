import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Length } from 'class-validator';

@InputType()
export class SendCustomerOtpInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  phone: string;
}

@InputType()
export class VerifyCustomerOtpInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  phone: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  code: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

@InputType()
export class VendorLoginInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  password: string;
}

@InputType()
export class RefreshTokenInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  refreshToken: string;
}

@InputType()
export class SwitchStoreInput {
  @Field()
  @IsUUID()
  storeId: string;
}

@InputType()
export class UpdateUserProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  fullName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  profilePhotoUrl?: string | null;
}

@InputType()
export class ChangePasswordInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(8, 128)
  newPassword: string;
}

@InputType()
export class RequestPasswordResetInput {
  @Field()
  @IsEmail()
  email: string;
}

@InputType()
export class ReactivateAccountInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  reactivationToken: string;
}

@InputType()
export class ResetPasswordInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  token: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(8, 128)
  newPassword: string;
}

@InputType()
export class VerifyEmailInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  token: string;
}
