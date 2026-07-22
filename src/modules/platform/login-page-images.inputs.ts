import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class UpdateLoginPageImagesInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  desktopImageUrl!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  mobileImageUrl?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  altText?: string | null;
}
