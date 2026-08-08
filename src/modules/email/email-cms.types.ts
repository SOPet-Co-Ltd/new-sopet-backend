import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';
import { EmailTemplateKey } from '../../database/entities/enums/email-template.enums';

registerEnumType(EmailTemplateKey, {
  name: 'EmailTemplateKey',
  description: 'Route key for a transactional email content template',
});

@ObjectType()
export class EmailPlaceholderInfoType {
  @Field()
  name!: string;

  @Field()
  trustedHtml!: boolean;

  @Field()
  required!: boolean;

  @Field()
  sample!: string;
}

@ObjectType()
export class EmailContainerType {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  htmlShell!: string;

  @Field()
  isDefault!: boolean;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  /** Save-time warnings (e.g. flex/grid, large HTML) — empty on plain queries. */
  @Field(() => [String])
  warnings!: string[];
}

@ObjectType()
export class EmailContentTemplateType {
  @Field(() => ID)
  id!: string;

  @Field(() => EmailTemplateKey)
  key!: EmailTemplateKey;

  @Field()
  name!: string;

  @Field()
  subjectTemplate!: string;

  @Field()
  bodyHtml!: string;

  @Field()
  textTemplate!: string;

  @Field(() => ID)
  containerId!: string;

  @Field(() => EmailContainerType)
  container!: EmailContainerType;

  @Field()
  enabled!: boolean;

  @Field(() => [EmailPlaceholderInfoType])
  allowedPlaceholders!: EmailPlaceholderInfoType[];

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  /** Save-time warnings — empty on plain queries. */
  @Field(() => [String])
  warnings!: string[];
}

@ObjectType()
export class EmailPreviewResultType {
  @Field()
  subject!: string;

  @Field()
  html!: string;

  @Field()
  text!: string;

  @Field(() => [String])
  missingPlaceholders!: string[];

  @Field(() => [String])
  warnings!: string[];
}
