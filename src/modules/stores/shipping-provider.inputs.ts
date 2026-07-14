import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class CreateShippingProviderInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  @Length(1, 100)
  name!: string;
}

@InputType()
export class UpdateShippingProviderInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
