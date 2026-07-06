import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailService } from '../email/email.service';
import { Order } from '../../database/entities/order.entity';
import { Customer } from '../../database/entities/customer.entity';
import { UserNotification } from '../../database/entities/user-notification.entity';
import { NotificationChannel } from '../../database/entities/notification.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { User, UserRole } from '../../database/entities/user.entity';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly storefrontUrl: string;

  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(UserNotification)
    private readonly userNotificationRepository: Repository<UserNotification>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreRequest)
    private readonly storeRequestRepository: Repository<StoreRequest>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    this.storefrontUrl =
      this.configService.get<string>('app.storefrontUrl') ||
      process.env.STOREFRONT_URL ||
      'http://localhost:3000';
  }

  async notifyOrderPaid(order: Order): Promise<void> {
    const customer = order.customerId
      ? await this.customerRepository.findOne({ where: { id: order.customerId } })
      : null;

    const email = customer?.email ?? order.guestEmail;
    if (!email) {
      this.logger.log(`No email for order ${order.orderNumber} — skip paid notification`);
      return;
    }

    const orderUrl = order.customerId
      ? `${this.storefrontUrl}/account/orders/${order.id}`
      : `${this.storefrontUrl}/checkout/success?orderId=${order.id}`;
    await this.emailService.send({
      to: email,
      subject: `Payment received — Order ${order.orderNumber}`,
      html: `
        <p>Thank you! We received your payment for order <strong>${order.orderNumber}</strong>.</p>
        <p>Total: ฿${Number(order.total).toLocaleString('th-TH')}</p>
        <p><a href="${orderUrl}">View your order</a></p>
      `,
      text: `Payment received for order ${order.orderNumber}. Total ฿${order.total}. View: ${orderUrl}`,
    });
  }

  async notifyOrderStatusChanged(order: Order, status: string): Promise<void> {
    const customer = order.customerId
      ? await this.customerRepository.findOne({ where: { id: order.customerId } })
      : null;

    const email = customer?.email ?? order.guestEmail;
    if (!email) {
      return;
    }

    const orderUrl = order.customerId
      ? `${this.storefrontUrl}/account/orders/${order.id}`
      : `${this.storefrontUrl}/checkout/success?orderId=${order.id}`;
    await this.emailService.send({
      to: email,
      subject: `Order ${order.orderNumber} — ${status.replace(/_/g, ' ')}`,
      html: `
        <p>Your order <strong>${order.orderNumber}</strong> is now <strong>${status}</strong>.</p>
        <p><a href="${orderUrl}">Track your order</a></p>
      `,
      text: `Order ${order.orderNumber} status: ${status}. ${orderUrl}`,
    });
  }

  async createUserNotification(
    userId: string,
    type: string,
    message: string,
    metadata: Record<string, unknown> = {},
  ): Promise<UserNotification> {
    const notification = this.userNotificationRepository.create({
      userId,
      type,
      message,
      metadata,
      channel: NotificationChannel.PUSH,
    });
    return this.userNotificationRepository.save(notification);
  }

  async findByUser(userId: string, unreadOnly?: boolean): Promise<UserNotification[]> {
    const qb = this.userNotificationRepository
      .createQueryBuilder('notification')
      .where('notification.user_id = :userId', { userId })
      .orderBy('notification.created_at', 'DESC');

    if (unreadOnly) {
      qb.andWhere('notification.is_read = false');
    }

    return qb.getMany();
  }

  async markAsRead(id: string, userId: string): Promise<boolean> {
    const notification = await this.userNotificationRepository.findOne({
      where: { id, userId },
    });
    if (!notification) {
      throw new NotFoundException({
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      });
    }
    if (!notification.isRead) {
      notification.isRead = true;
      await this.userNotificationRepository.save(notification);
    }
    return true;
  }

  async markAllAsRead(userId: string): Promise<boolean> {
    await this.userNotificationRepository.update({ userId, isRead: false }, { isRead: true });
    return true;
  }

  async countUnread(userId: string): Promise<number> {
    const result = await this.userNotificationRepository
      .createQueryBuilder('notification')
      .select('COUNT(*)', 'count')
      .where('notification.user_id = :userId', { userId })
      .andWhere('notification.is_read = false')
      .getRawOne();
    return parseInt(result?.count ?? '0', 10);
  }

  /**
   * Notify a vendor that a store request has been submitted (for admin).
   * Actually this is for admin to see there's a pending request.
   */
  async notifyAdminAboutNewRequest(request: StoreRequest): Promise<UserNotification> {
    const admins = await this.userRepository.find({
      where: { role: UserRole.ADMIN, isActive: true },
    });

    const notifications: UserNotification[] = [];
    for (const admin of admins) {
      notifications.push(
        await this.createUserNotification(
          admin.id,
          'new_store_request',
          `ร้านใหม่ "${request.storeName}" กำลังรอการอนุมัติ`,
          { requestId: request.id, storeName: request.storeName, storeRequestId: request.id },
        ),
      );
    }
    return notifications[0];
  }

  /**
   * Notify a vendor that their store has been approved or rejected.
   */
  async notifyVendorAboutStoreStatus(
    vendorId: string,
    store: Store,
    status: 'approved' | 'rejected',
    rejectionReason?: string,
  ): Promise<UserNotification> {
    const subject =
      status === 'approved'
        ? `ร้าน "${store.name}" ของคุณได้รับการอนุมัติแล้ว`
        : `ร้าน "${store.name}" ได้รับการปฏิเสธ`;

    return this.createUserNotification(vendorId, 'store_status_changed', subject, {
      storeId: store.id,
      storeName: store.name,
      status,
      rejectionReason,
    });
  }

  /**
   * Notify a vendor about a new order on their store.
   */
  async notifyVendorAboutNewOrder(storeId: string, order: Order): Promise<UserNotification | null> {
    // Find the vendor who owns this store
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      relations: ['owner'],
    });
    if (!store?.owner) {
      return null;
    }

    return this.createUserNotification(
      store.owner.id,
      'new_order',
      `มีออเดอร์ใหม่ #${order.orderNumber} — ฿${Number(order.total).toLocaleString('th-TH')}`,
      { orderId: order.id, orderNumber: order.orderNumber, total: Number(order.total) },
    );
  }

  /**
   * Notify a vendor about an order status change.
   */
  async notifyVendorAboutOrderStatus(
    storeId: string,
    order: Order,
    status: string,
  ): Promise<UserNotification | null> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      relations: ['owner'],
    });
    if (!store?.owner) {
      return null;
    }

    return this.createUserNotification(
      store.owner.id,
      'order_status_changed',
      `ออเดอร์ #${order.orderNumber} เปลี่ยนเป็น "${status.replace(/_/g, ' ')}"`,
      { orderId: order.id, orderNumber: order.orderNumber, status },
    );
  }

  /**
   * Notify a vendor about the status of their request (store reactivation, etc.).
   */
  async notifyVendorAboutRequestStatus(
    vendorId: string,
    type: string,
    title: string,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): Promise<UserNotification> {
    return this.createUserNotification(vendorId, 'request_status_changed', title, {
      type,
      success,
      ...metadata,
    });
  }
}
