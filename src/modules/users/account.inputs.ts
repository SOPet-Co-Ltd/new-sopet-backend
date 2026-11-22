import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

@InputType()
export class CreateAddressInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 255)
  label!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  recipientName!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  recipientPhone!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  addressLine1!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  tumbon?: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  amphoe!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  province!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  postalCode!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class UpdateProfileInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  fullName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEmail()
  email?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  profilePhotoUrl?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  dateOfBirth?: string | null;
}

@InputType()
export class UpdateAddressInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  label?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  recipientName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  tumbon?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  amphoe?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  city?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  province?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class AddressIdInput {
  @Field()
  @IsUUID()
  id!: string;
}

@InputType()
export class AddPaymentMethodInput {
  /** RSA-OAEP ciphertext (`rsa:v1:...`) of `{ cardholderName, pan, expiryMonth, expiryYear }`. */
  @Field()
  @IsNotEmpty()
  @IsString()
  cardCipher!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class ChangeCustomerPhoneInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  phone!: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(6, 6)
  code!: string;
}
