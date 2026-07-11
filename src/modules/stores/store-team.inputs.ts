import { Field, InputType } from '@nestjs/graphql';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
} from 'class-validator';
import { StoreMemberRole } from '../../database/entities/store-member.entity';

@InputType()
export class InviteStoreMemberInput {
  @Field()
  @IsEmail()
  email: string;

  @Field()
  @IsEnum(StoreMemberRole)
  role: StoreMemberRole;
}

@InputType()
export class AcceptStoreMemberInvitationInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  token: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  password: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  fullName: string;
}

@InputType()
export class UpdateStoreMemberRoleInput {
  @Field()
  @IsUUID()
  memberId: string;

  @Field()
  @IsEnum(StoreMemberRole)
  role: StoreMemberRole;
}

@InputType()
export class UpdateStoreSettingsInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

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
export class UpdateStorePayoutInput {
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

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  bankCode?: string;
}
