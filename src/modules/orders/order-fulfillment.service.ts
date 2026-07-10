import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { Payment } from '../../database/entities/payment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { StoresService } from '../stores/stores.service';
import { PaymentsService } from '../payments/payments.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  assertVendorItemsUniform,
  deriveOrderStatusFromFulfillment,
  validateFulfillmentProvider,
  validateOptionalTrackingUrl,
  validateTrackingNumber,
  VENDOR_CANCELLABLE_ORDER_STATUSES,
} from './order-fulfillment.util';

@Injectable()
export class OrderFulfillmentService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly storesService: StoresService,
    private readonly notificationsService: NotificationsService,
    private readonly paymentsService: PaymentsService,
    private readonly inventoryService: InventoryService,
  ) {}

  private async loadOrderWithItems(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['items', 'shippingAddress', 'storeShippings', 'customer'],
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    return order;
  }

  private async assertVendorStoreAccess(
    userId: string,
    order: Order,
    storeId: string,
  ): Promise<OrderItem[]> {
    const accessibleStores = await this.storesService.getAccessibleStores(userId);
    const ownedStoreIds = new Set(accessibleStores.map((entry) => entry.store.id));
    if (!ownedStoreIds.has(storeId)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this store',
      });
    }

    const storeItems = order.items.filter((item) => item.storeId === storeId);
    if (storeItems.length === 0) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this order',
      });
    }

    return storeItems;
  }

  private assertSingleStoreOrder(order: Order, storeId: string): void {
    const storeIds = new Set(order.items.map((item) => item.storeId));
    if (storeIds.size !== 1 || !storeIds.has(storeId)) {
      throw new BadRequestException({
        code: 'MULTI_VENDOR_ORDER',
        message: 'Only single-store orders can be cancelled by the vendor',
      });
    }
  }

  private markItemsCancelled(items: OrderItem[]): void {
    const now = new Date();
    for (const item of items) {
      item.fulfillmentStatus = FulfillmentStatus.CANCELLED;
      item.updatedAt = now;
    }
  }

  private async persistOrderTransition(
    order: Order,
    nextStatus: OrderStatus,
    userId: string,
    notes: string,
    options?: { saveItems?: boolean },
  ): Promise<Order> {
    const previousStatus = order.status;

    await this.dataSource.transaction(async (manager) => {
      if (options?.saveItems) {
        await manager.save(OrderItem, order.items);
      }

      order.status = nextStatus;
      if (nextStatus === OrderStatus.PAID && !order.paidAt) {
        order.paidAt = new Date();
      }

      await manager.save(Order, order);
      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          status: nextStatus,
          changedBy: userId,
          notes,
        }),
      );
    });

    const saved = await this.loadOrderWithItems(order.id);
    if (previousStatus !== nextStatus) {
      await this.notificationsService.notifyOrderStatusChanged(saved, nextStatus);
      this.notificationsService.notifyVendorsAboutOrderStatus(saved, nextStatus).catch(() => {});
    }

    return saved;
  }

  async markVendorOrderPaid(userId: string, storeId: string, orderId: string): Promise<Order> {
    const order = await this.loadOrderWithItems(orderId);
    await this.assertVendorStoreAccess(userId, order, storeId);

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Only pending payment orders can be marked as paid',
      });
    }

    return this.persistOrderTransition(
      order,
      OrderStatus.PAID,
      userId,
      `Vendor marked order paid (store ${storeId})`,
    );
  }

  async acknowledgeVendorOrder(userId: string, storeId: string, orderId: string): Promise<Order> {
    const order = await this.loadOrderWithItems(orderId);
    const storeItems = await this.assertVendorStoreAccess(userId, order, storeId);

    if (order.status !== OrderStatus.PAID && order.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Order must be paid before acknowledgement',
      });
    }

    assertVendorItemsUniform(
      storeItems.map((item) => item.fulfillmentStatus),
      FulfillmentStatus.PENDING,
    );

    const now = new Date();
    for (const item of storeItems) {
      item.fulfillmentStatus = FulfillmentStatus.PROCESSING;
      item.updatedAt = now;
    }

    const nextStatus = deriveOrderStatusFromFulfillment(
      order.status,
      order.items.map((item) => item.fulfillmentStatus),
    );

    return this.persistOrderTransition(
      order,
      nextStatus,
      userId,
      `Vendor acknowledged order for customer (store ${storeId})`,
      { saveItems: true },
    );
  }

  async shipVendorOrder(
    userId: string,
    storeId: string,
    orderId: string,
    trackingNumber: string,
    fulfillmentProvider: string,
    trackingUrl?: string | null,
  ): Promise<Order> {
    const order = await this.loadOrderWithItems(orderId);
    const storeItems = await this.assertVendorStoreAccess(userId, order, storeId);
    const normalizedTrackingNumber = validateTrackingNumber(trackingNumber);
    const normalizedFulfillmentProvider = validateFulfillmentProvider(fulfillmentProvider);
    const normalizedTrackingUrl = validateOptionalTrackingUrl(trackingUrl);

    if (
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.PROCESSING &&
      order.status !== OrderStatus.SHIPPED
    ) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Order cannot be shipped in its current status',
      });
    }

    assertVendorItemsUniform(
      storeItems.map((item) => item.fulfillmentStatus),
      FulfillmentStatus.PROCESSING,
    );

    const shippedAt = new Date();
    for (const item of storeItems) {
      item.fulfillmentStatus = FulfillmentStatus.SHIPPED;
      item.trackingNumber = normalizedTrackingNumber;
      item.fulfillmentProvider = normalizedFulfillmentProvider;
      item.trackingUrl = normalizedTrackingUrl;
      item.shippedAt = shippedAt;
      item.updatedAt = shippedAt;
    }

    const nextStatus = deriveOrderStatusFromFulfillment(
      order.status,
      order.items.map((item) => item.fulfillmentStatus),
    );

    return this.persistOrderTransition(
      order,
      nextStatus,
      userId,
      `Vendor shipped order with tracking URL (store ${storeId})`,
      { saveItems: true },
    );
  }

  async confirmOrderDelivered(
    orderId: string,
    customerId?: string,
    guestPhone?: string,
  ): Promise<Order> {
    const order = await this.loadOrderWithItems(orderId);

    if (customerId) {
      if (order.customerId !== customerId) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have access to this order',
        });
      }
    } else if (guestPhone) {
      const normalizedGuestPhone = guestPhone.replace(/\D/g, '');
      const orderGuestPhone = order.guestPhone?.replace(/\D/g, '');
      if (!orderGuestPhone || orderGuestPhone !== normalizedGuestPhone) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'You do not have access to this order',
        });
      }
    } else {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Authentication required to confirm delivery',
      });
    }

    if (order.status !== OrderStatus.SHIPPED) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Order must be shipped before delivery can be confirmed',
      });
    }

    if (
      !order.items.every(
        (item) =>
          item.fulfillmentStatus === FulfillmentStatus.SHIPPED ||
          item.fulfillmentStatus === FulfillmentStatus.DELIVERED,
      )
    ) {
      throw new BadRequestException({
        code: 'ORDER_NOT_FULLY_SHIPPED',
        message: 'All items must be shipped before delivery can be confirmed',
      });
    }

    const deliveredAt = new Date();
    for (const item of order.items) {
      item.fulfillmentStatus = FulfillmentStatus.DELIVERED;
      item.deliveredAt = deliveredAt;
      item.updatedAt = deliveredAt;
    }

    return this.persistOrderTransition(
      order,
      OrderStatus.DELIVERED,
      customerId ?? 'guest',
      'Customer confirmed order delivery',
      { saveItems: true },
    );
  }

  async cancelVendorOrder(userId: string, storeId: string, orderId: string): Promise<Order> {
    const order = await this.loadOrderWithItems(orderId);
    await this.assertVendorStoreAccess(userId, order, storeId);
    this.assertSingleStoreOrder(order, storeId);

    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException({
        code: 'ORDER_ALREADY_CANCELLED',
        message: 'Order is already cancelled',
      });
    }

    if (!VENDOR_CANCELLABLE_ORDER_STATUSES.has(order.status)) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_STATUS',
        message: 'Order cannot be cancelled after it has been shipped',
      });
    }

    const refundedOnline = await this.paymentsService.refundPaidOnlineOrder(orderId);

    if (refundedOnline) {
      const updated = await this.loadOrderWithItems(orderId);
      this.markItemsCancelled(updated.items);

      await this.dataSource.transaction(async (manager) => {
        await manager.save(OrderItem, updated.items);
        await manager.save(
          OrderStatusHistory,
          manager.create(OrderStatusHistory, {
            orderId,
            status: OrderStatus.REFUNDED,
            changedBy: userId,
            notes: `Vendor cancelled order with customer refund (store ${storeId})`,
          }),
        );
      });

      const saved = await this.loadOrderWithItems(orderId);
      await this.notificationsService.notifyOrderStatusChanged(saved, OrderStatus.REFUNDED);
      this.notificationsService
        .notifyVendorsAboutOrderStatus(saved, OrderStatus.REFUNDED)
        .catch(() => {});

      return saved;
    }

    this.markItemsCancelled(order.items);

    await this.dataSource.transaction(async (manager) => {
      order.status = OrderStatus.CANCELLED;
      await manager.save(Order, order);
      await manager.save(OrderItem, order.items);

      await this.inventoryService.restoreOrderStock(order.id, manager, 'Vendor cancelled order');

      const pendingPayments = await manager.find(Payment, {
        where: { orderId: order.id, status: 'pending' },
      });
      for (const payment of pendingPayments) {
        payment.status = 'failed';
        await manager.save(payment);
      }

      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          changedBy: userId,
          notes: `Vendor cancelled order (store ${storeId})`,
        }),
      );
    });

    const saved = await this.loadOrderWithItems(orderId);
    await this.notificationsService.notifyOrderStatusChanged(saved, OrderStatus.CANCELLED);
    this.notificationsService
      .notifyVendorsAboutOrderStatus(saved, OrderStatus.CANCELLED)
      .catch(() => {});

    return saved;
  }
}
