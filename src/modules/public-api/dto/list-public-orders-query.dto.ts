import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../../../database/entities/order.entity';
import { FulfillmentStatus } from '../../../database/entities/order-item.entity';

export class ListPublicOrdersQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page (max 100)',
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by order status (omit = all statuses with items for this store)',
    enum: OrderStatus,
    example: OrderStatus.PAID,
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description:
      'Only orders with at least one line item for this store in the given fulfillment status',
    enum: FulfillmentStatus,
    example: FulfillmentStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(FulfillmentStatus)
  fulfillmentStatus?: FulfillmentStatus;

  @ApiPropertyOptional({
    description: 'ISO-8601 — only orders updated at or after this time (catch-up / polling)',
    example: '2026-08-23T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  updatedSince?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 — only orders created at or after this time',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  createdSince?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 — only orders created at or before this time',
    example: '2026-08-23T23:59:59.000Z',
  })
  @IsOptional()
  @IsDateString()
  createdUntil?: string;
}
