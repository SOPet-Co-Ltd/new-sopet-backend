import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

@InputType()
export class CreateEmailContainerInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name!: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  htmlShell!: string;

  @Field({ nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class UpdateEmailContainerInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  htmlShell?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@InputType()
export class UpdateEmailContentTemplateInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  subjectTemplate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  textTemplate?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  containerId?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@InputType()
export class PreviewEmailContentTemplateInput {
  @Field(() => EmailTemplateKey)
  @IsNotEmpty()
  key!: EmailTemplateKey;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  subjectTemplate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  textTemplate?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  containerId?: string;

  /**
   * JSON-encoded `Record<string, string>` of placeholder → sample value.
   * (Plain `String` rather than a custom `JSON` GraphQL scalar — no such
   * scalar exists yet in this schema; avoids adding a new dependency.)
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  variablesJson?: string;
}

@InputType()
export class SendTestEmailContentTemplateInput {
  @Field(() => EmailTemplateKey)
  @IsNotEmpty()
  key!: EmailTemplateKey;

  /** Destination inbox for the test message. Falls back to the admin session email when omitted. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  toEmail?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  subjectTemplate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  textTemplate?: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  containerId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  variablesJson?: string;
}
