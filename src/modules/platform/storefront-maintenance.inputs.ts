import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import {
  STOREFRONT_MAINTENANCE_REASONS,
  type StorefrontMaintenanceReason,
} from './storefront-maintenance-settings.service';

export enum StorefrontMaintenanceReasonEnum {
  MAINTENANCE = 'MAINTENANCE',
  NOT_READY = 'NOT_READY',
  SYSTEM_UPDATE = 'SYSTEM_UPDATE',
  OTHER = 'OTHER',
}

registerEnumType(StorefrontMaintenanceReasonEnum, {
  name: 'StorefrontMaintenanceReason',
  description: 'Why the storefront is closed for visitors',
});

@InputType()
export class UpdateStorefrontMaintenanceInput {
  @Field()
  @IsBoolean()
  enabled!: boolean;

  @Field(() => StorefrontMaintenanceReasonEnum, { nullable: true })
  @ValidateIf((o: UpdateStorefrontMaintenanceInput) => o.enabled === true)
  @IsEnum(StorefrontMaintenanceReasonEnum)
  reason?: StorefrontMaintenanceReason | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  customMessage?: string | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  untilAt?: string | null;
}

export { STOREFRONT_MAINTENANCE_REASONS };
