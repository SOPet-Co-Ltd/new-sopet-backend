import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

@InputType()
export class CreateCategoryInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

@InputType()
export class UpdateCategoryInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;
}

@InputType()
export class SetCategoryImageInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;
}

@InputType()
export class CreateTagInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;
}

@InputType()
export class CreatePetTypeInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  imageUrl?: string | null;
}

@InputType()
export class UpdatePetTypeInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  petTypeId!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;
}

@InputType()
export class SetPetTypeImageInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  petTypeId!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  imageUrl!: string;
}

@InputType()
export class CreateBrandInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;
}

@InputType()
export class DeleteTaxonomyInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  replacementCategoryId?: string;
}
