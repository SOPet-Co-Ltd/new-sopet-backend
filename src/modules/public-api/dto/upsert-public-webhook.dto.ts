import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsUrl,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  VENDOR_WEBHOOK_EVENTS,
  VendorWebhookEvent,
} from '../../../database/entities/store-webhook.entity';

export class UpsertPublicWebhookDto {
  @ApiProperty({ example: 'https://example.com/hooks/sopet' })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({
    type: [String],
    enum: VENDOR_WEBHOOK_EVENTS,
    example: [
      'order.create',
      'order.payment_failed',
      'order.paid',
      'order.processing',
      'order.on_hold',
      'order.shipped',
      'order.delivered',
      'order.cancelled',
      'order.refunded',
    ],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...VENDOR_WEBHOOK_EVENTS], { each: true })
  events?: VendorWebhookEvent[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'When true, generate a new signing secret (returned once in the response)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rotateSecret?: boolean;
}

export class UpdatePublicOrderTrackingDto {
  @ApiProperty({ example: 'TH123456789' })
  @IsString()
  @MaxLength(100)
  trackingNumber!: string;

  @ApiProperty({ example: 'Kerry' })
  @IsString()
  @MaxLength(100)
  fulfillmentProvider!: string;

  @ApiPropertyOptional({ example: 'https://th.kerryexpress.com/track/TH123456789' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(2048)
  trackingUrl?: string;
}
