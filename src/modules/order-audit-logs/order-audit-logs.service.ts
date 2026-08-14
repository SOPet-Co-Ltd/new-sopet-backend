import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrderAuditLog } from '../../database/entities/order-audit-log.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { StoresService } from '../stores/stores.service';
import {
  AppendOrderAuditInput,
  FALLBACK_CUSTOMER_ACTOR_LABEL,
  ORDER_AUDIT_EVENT_TYPES,
  OrderAuditActorType,
  OrderAuditEventType,
  OrderAuditLogDetails,
  VENDOR_ADMIN_ACTOR_LABEL,
} from './order-audit-log.constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type VendorOrderAuditLogResult = {
  orderId: string;
  entries: VendorOrderAuditLogEntry[];
};

export type VendorOrderAuditLogEntry = {
  id: string;
  orderId: string;
  eventType: OrderAuditEventType;
  occurredAt: Date;
  actorType: OrderAuditActorType;
  actorId: string | null;
  actorLabel: string | null;
  storeId: string | null;
  details: OrderAuditLogDetails;
};

@Injectable()
export class OrderAuditLogsService {
  constructor(
    @InjectRepository(OrderAuditLog)
    private readonly orderAuditLogRepository: Repository<OrderAuditLog>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly storesService: StoresService,
  ) {}

  async append(manager: EntityManager, input: AppendOrderAuditInput): Promise<void> {
    if (!ORDER_AUDIT_EVENT_TYPES.has(input.eventType)) {
      throw new BadRequestException({
        code: 'INVALID_AUDIT_EVENT',
        message: 'Unknown order audit event type',
      });
    }

    if (input.eventType === OrderAuditEventType.ORDER_ACCEPTED && !input.storeId) {
      throw new BadRequestException({
        code: 'INVALID_AUDIT_EVENT',
        message: 'ORDER_ACCEPTED requires storeId',
      });
    }

    const storeId =
      input.eventType === OrderAuditEventType.ORDER_ACCEPTED ? (input.storeId ?? null) : null;
    const details: Record<string, unknown> = { ...(input.details ?? {}) };

    await manager.save(
      OrderAuditLog,
      manager.create(OrderAuditLog, {
        orderId: input.orderId,
        eventType: input.eventType,
        occurredAt: input.occurredAt ?? new Date(),
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        storeId,
        details,
      }),
    );
  }

  async resolveCustomerActorLabel(
    manager: EntityManager,
    order: Pick<Order, 'customerId' | 'guestName'>,
  ): Promise<string> {
    const guestName = order.guestName?.trim();
    if (guestName) {
      return guestName;
    }

    if (order.customerId) {
      const customer = await manager.findOne(Customer, { where: { id: order.customerId } });
      const fullName = customer?.fullName?.trim();
      if (fullName) {
        return fullName;
      }
    }

    return FALLBACK_CUSTOMER_ACTOR_LABEL;
  }

  async listForVendor(
    userId: string,
    storeId: string,
    orderId: string,
  ): Promise<VendorOrderAuditLogResult> {
    if (!UUID_RE.test(orderId) || !UUID_RE.test(storeId)) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    await this.storesService.assertStoreAccess(userId, storeId);

    const storeItemCount = await this.orderItemRepository.count({
      where: { orderId, storeId },
    });
    if (storeItemCount === 0) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const rows = await this.orderAuditLogRepository.find({
      where: { orderId },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });

    const entries = rows
      .filter((row) => {
        if (row.eventType !== OrderAuditEventType.ORDER_ACCEPTED) {
          return true;
        }
        return row.storeId === storeId;
      })
      .map((row) => this.mapVendorEntry(row));

    return { orderId, entries };
  }

  private mapVendorEntry(row: OrderAuditLog): VendorOrderAuditLogEntry {
    const isAdmin = row.actorType === OrderAuditActorType.admin;
    const rawDetails = (row.details ?? {}) as OrderAuditLogDetails;

    return {
      id: row.id,
      orderId: row.orderId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      actorType: row.actorType,
      actorId: isAdmin ? null : row.actorId,
      actorLabel: isAdmin ? VENDOR_ADMIN_ACTOR_LABEL : row.actorLabel,
      storeId: row.storeId,
      details: {
        paymentMethod: rawDetails.paymentMethod ?? null,
        previousPaymentMethod: rawDetails.previousPaymentMethod ?? null,
        newPaymentMethod: rawDetails.newPaymentMethod ?? null,
        approvalMethod: rawDetails.approvalMethod ?? null,
        note: null,
        storeId: rawDetails.storeId ?? row.storeId ?? null,
      },
    };
  }
}
