import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const UPLOAD_FOLDERS = [
  'products',
  'stores',
  'reviews',
  'profiles',
  'banners',
  'sponsors',
  'ads',
  'categories',
] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

@InputType()
export class UploadImageInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  base64: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(UPLOAD_FOLDERS)
  folder?: UploadFolder;
}
