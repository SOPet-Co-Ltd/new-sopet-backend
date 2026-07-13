import { Field, InputType } from '@nestjs/graphql';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AuditActorType } from '../../database/entities/audit-log.entity';

@InputType()
export class AdminAuditLogFilterInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  action?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEnum(AuditActorType)
  actorType?: AuditActorType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  fromDate?: Date;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  toDate?: Date;
}
