import { Args, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, Roles } from '../../common/decorators';
import { OrderAuditLogsService } from './order-audit-logs.service';
import { OrderAuditLogEntryType, OrderAuditLogType } from './order-audit-logs.types';

@Resolver()
export class OrderAuditLogsResolver {
  constructor(private readonly orderAuditLogsService: OrderAuditLogsService) {}

  @Query(() => OrderAuditLogType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async orderAuditLog(
    @Args('orderId') orderId: string,
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<OrderAuditLogType> {
    const result = await this.orderAuditLogsService.listForVendor(userId, storeId, orderId);
    return {
      orderId: result.orderId,
      entries: result.entries.map((entry): OrderAuditLogEntryType => ({
        id: entry.id,
        orderId: entry.orderId,
        eventType: entry.eventType,
        occurredAt: entry.occurredAt,
        actorType: entry.actorType,
        actorId: entry.actorId,
        actorLabel: entry.actorLabel,
        storeId: entry.storeId,
        details: entry.details,
      })),
    };
  }
}
