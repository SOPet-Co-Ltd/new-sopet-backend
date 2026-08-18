import { Field, InputType } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class UpdateBankTransferDetailsInput {
  @Field()
  @IsBoolean()
  enabled!: boolean;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  bankName!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  accountName!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  accountNumber!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  branchName?: string | null;
}
