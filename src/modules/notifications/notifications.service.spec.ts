import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EmailDeliveryService } from '../email/email-delivery.service';
import { Customer } from '../../database/entities/customer.entity';
import { UserNotification } from '../../database/entities/user-notification.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationChannel } from '../../database/entities/notification.entity';
import { Order } from '../../database/entities/order.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const emailDeliveryService = {
    sendOrderPaid: jest.fn(),
    sendOrderStatusChanged: jest.fn(),
  };

  const configService = {
    get: jest.fn().mockReturnValue('https://store.example.com'),
  };

  const customerRepo = {
    findOne: jest.fn(),
  };

  const userNotificationRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    findOne: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const storeRepo = {
    findOne: jest.fn(),
  };

  const storeRequestRepo = {
    findOne: jest.fn(),
  };

  const userRepo = {
    find: jest.fn(),
  };

  const orderRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: EmailDeliveryService, useValue: emailDeliveryService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        {
          provide: getRepositoryToken(UserNotification),
          useValue: userNotificationRepo,
        },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: getRepositoryToken(StoreRequest), useValue: storeRequestRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('notifyOrderPaid', () => {
    function mockNoDedupeHit() {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
    }

    it('sends email when customer has email', async () => {
      mockNoDedupeHit();
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        paymentMethod: 'promptpay',
        subtotal: 1400,
        discountAmount: 0,
        shippingFee: 100,
        total: 1500,
        createdAt: new Date('2025-07-11T12:00:00.000Z'),
        paidAt: new Date('2025-07-11T12:05:00.000Z'),
        items: [
          {
            productName: 'Dog Food Premium',
            variantOptions: { ขนาด: '2kg' },
            quantity: 1,
            unitPrice: 1400,
            subtotal: 1400,
          },
        ],
      } as unknown as Order;
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        email: 'user@example.com',
        fullName: 'คุณสมชาย',
      });

      await service.notifyOrderPaid(order);

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cust-1',
          type: 'payment_received',
          message: expect.stringContaining('ORD-001'),
        }),
      );
      expect(emailDeliveryService.sendOrderPaid).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          orderNumber: 'ORD-001',
          total: 1500,
          customerName: 'คุณสมชาย',
          items: expect.arrayContaining([
            expect.objectContaining({
              productName: 'Dog Food Premium',
              quantity: 1,
            }),
          ]),
        }),
      );
      expect(orderRepo.findOne).not.toHaveBeenCalled();
    });

    it('creates in-app notification even when customer has no email', async () => {
      mockNoDedupeHit();
      const order = {
        id: 'order-3',
        orderNumber: 'ORD-003',
        customerId: 'cust-1',
        guestEmail: null,
        paymentMethod: 'promptpay',
        subtotal: 100,
        discountAmount: 0,
        shippingFee: 0,
        total: 100,
        createdAt: new Date(),
        paidAt: new Date(),
        items: [],
      } as unknown as Order;
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: null, fullName: 'Buyer' });

      await service.notifyOrderPaid(order);

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'cust-1', type: 'payment_received' }),
      );
      expect(emailDeliveryService.sendOrderPaid).not.toHaveBeenCalled();
    });

    it('skips when no email (guest without guestEmail)', async () => {
      const order = {
        id: 'order-2',
        orderNumber: 'ORD-002',
        customerId: null,
        guestEmail: null,
        total: 500,
      } as Order;

      await service.notifyOrderPaid(order);

      expect(customerRepo.findOne).not.toHaveBeenCalled();
      expect(userNotificationRepo.create).not.toHaveBeenCalled();
      expect(emailDeliveryService.sendOrderPaid).not.toHaveBeenCalled();
    });
  });

  describe('notifyOrderStatusChanged', () => {
    function mockNoDedupeHit() {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
    }

    it('sends email and creates in-app customer notification', async () => {
      mockNoDedupeHit();
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        guestEmail: null,
        createdAt: new Date('2025-07-11T12:00:00.000Z'),
        items: [],
      } as unknown as Order;
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'user@example.com' });

      await service.notifyOrderStatusChanged(order, 'shipped');

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cust-1',
          type: 'order_status_changed',
          message: expect.stringContaining('จัดส่งแล้ว'),
          metadata: expect.objectContaining({ status: 'shipped', orderId: 'order-1' }),
        }),
      );
      expect(emailDeliveryService.sendOrderStatusChanged).toHaveBeenCalledWith(
        'user@example.com',
        expect.objectContaining({
          orderNumber: 'ORD-001',
          status: 'shipped',
          orderDate: expect.any(String),
        }),
      );
    });

    it('skips in-app for hold statuses (dedicated hold types)', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        guestEmail: null,
        createdAt: new Date(),
        items: [],
      } as unknown as Order;
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'user@example.com' });

      await service.notifyOrderStatusChanged(order, 'on_hold');

      expect(userNotificationRepo.create).not.toHaveBeenCalled();
      expect(emailDeliveryService.sendOrderStatusChanged).toHaveBeenCalled();
    });
  });

  describe('createUserNotification', () => {
    it('creates and saves', async () => {
      const saved = {
        userId: 'user-1',
        type: 'order_paid',
        message: 'Your order was paid',
        metadata: { orderId: 'order-1' },
        channel: NotificationChannel.PUSH,
      };
      userNotificationRepo.save.mockResolvedValue({ id: 'notif-1', ...saved });

      const result = await service.createUserNotification(
        'user-1',
        'order_paid',
        'Your order was paid',
        { orderId: 'order-1' },
      );

      expect(userNotificationRepo.create).toHaveBeenCalledWith({
        userId: 'user-1',
        type: 'order_paid',
        message: 'Your order was paid',
        metadata: { orderId: 'order-1' },
        channel: NotificationChannel.PUSH,
      });
      expect(userNotificationRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('notif-1');
    });

    it('returns existing notification when dedupe keys match', async () => {
      const existing = { id: 'notif-existing', type: 'new_order' };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(existing),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.createUserNotification(
        'user-1',
        'new_order',
        'duplicate',
        { orderId: 'order-1' },
        ['orderId'],
      );

      expect(result).toBe(existing);
      expect(userNotificationRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('findByUser', () => {
    it('returns notifications without unreadOnly filter', async () => {
      const notifications = [{ id: 'notif-1' }, { id: 'notif-2' }];
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(notifications),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findByUser('user-1');

      expect(qb.where).toHaveBeenCalledWith('notification.user_id = :userId', {
        userId: 'user-1',
      });
      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual(notifications);
    });

    it('filters unread when unreadOnly is true', async () => {
      const notifications = [{ id: 'notif-1', isRead: false }];
      const qb = {
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(notifications),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findByUser('user-1', true);

      expect(qb.andWhere).toHaveBeenCalledWith('notification.is_read = false');
      expect(result).toEqual(notifications);
    });
  });

  describe('markAsRead', () => {
    it('throws NotFoundException when missing', async () => {
      userNotificationRepo.findOne.mockResolvedValue(null);

      await expect(service.markAsRead('notif-missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates isRead', async () => {
      const notification = { id: 'notif-1', userId: 'user-1', isRead: false };
      userNotificationRepo.findOne.mockResolvedValue(notification);

      const result = await service.markAsRead('notif-1', 'user-1');

      expect(notification.isRead).toBe(true);
      expect(userNotificationRepo.save).toHaveBeenCalledWith(notification);
      expect(result).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('calls update', async () => {
      userNotificationRepo.update.mockResolvedValue({ affected: 3 });

      const result = await service.markAllAsRead('user-1');

      expect(userNotificationRepo.update).toHaveBeenCalledWith(
        { userId: 'user-1', isRead: false },
        { isRead: true },
      );
      expect(result).toBe(true);
    });
  });

  describe('notifyVendorAboutNewOrder', () => {
    it('returns existing notification for the same order', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        total: 1999,
      } as Order;
      const existing = { id: 'notif-existing', type: 'new_order' };

      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(existing),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.notifyVendorAboutNewOrder('store-1', order);

      expect(result).toBe(existing);
      expect(userNotificationRepo.save).not.toHaveBeenCalled();
    });

    it('creates notification when none exists', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        total: 1999,
      } as Order;

      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
      userNotificationRepo.save.mockResolvedValue({ id: 'notif-new' });

      const result = await service.notifyVendorAboutNewOrder('store-1', order);

      expect(userNotificationRepo.save).toHaveBeenCalled();
      expect(result).toEqual({ id: 'notif-new' });
    });
  });

  describe('notifyVendorsAboutOrderStatus', () => {
    it('notifies each store once for multi-item orders', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        items: [{ storeId: 'store-1' }, { storeId: 'store-1' }, { storeId: 'store-2' }],
      } as Order;

      storeRepo.findOne
        .mockResolvedValueOnce({ id: 'store-1', owner: { id: 'vendor-1' } })
        .mockResolvedValueOnce({ id: 'store-2', owner: { id: 'vendor-2' } });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
      userNotificationRepo.save.mockResolvedValue({ id: 'notif-new' });

      await service.notifyVendorsAboutOrderStatus(order, 'paid');

      expect(storeRepo.findOne).toHaveBeenCalledTimes(2);
      expect(userNotificationRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('notifyOrderItemsOnHold / notifyOrderItemsHoldResumed', () => {
    function mockNoDedupeHit() {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
    }

    it('creates customer + vendor enter-hold notifications with Design Doc types and dedupe keys', async () => {
      mockNoDedupeHit();
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-HOLD-1',
        customerId: 'cust-1',
        guestEmail: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        items: [{ storeId: 'store-1' }],
      });
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'c@example.com' });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });
      userNotificationRepo.save.mockImplementation(async (x) => ({ id: 'n-new', ...x }));

      await service.notifyOrderItemsOnHold('order-1', 'store-1');

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'cust-1',
          type: 'order_items_on_hold',
          metadata: expect.objectContaining({ orderId: 'order-1', storeId: 'store-1' }),
        }),
      );
      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'vendor-1',
          type: 'vendor_order_items_on_hold',
          metadata: expect.objectContaining({ orderId: 'order-1', storeId: 'store-1' }),
        }),
      );
      expect(emailDeliveryService.sendOrderStatusChanged).toHaveBeenCalledWith(
        'c@example.com',
        expect.objectContaining({ status: 'on_hold', orderNumber: 'ORD-HOLD-1' }),
      );
    });

    it('creates resume notifications with Design Doc types', async () => {
      mockNoDedupeHit();
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-HOLD-1',
        customerId: 'cust-1',
        guestEmail: null,
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        items: [{ storeId: 'store-1' }],
      });
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'c@example.com' });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });
      userNotificationRepo.save.mockImplementation(async (x) => ({ id: 'n-new', ...x }));

      await service.notifyOrderItemsHoldResumed('order-1', 'store-1');

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'order_items_hold_resumed', userId: 'cust-1' }),
      );
      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'vendor_order_items_hold_resumed',
          userId: 'vendor-1',
        }),
      );
      expect(emailDeliveryService.sendOrderStatusChanged).toHaveBeenCalledWith(
        'c@example.com',
        expect.objectContaining({ status: 'hold_resumed' }),
      );
    });

    it('dedupes enter-hold notification per orderId+storeId', async () => {
      const existing = { id: 'notif-existing', type: 'order_items_on_hold' };
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(existing),
      };
      userNotificationRepo.createQueryBuilder.mockReturnValue(qb);
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-HOLD-1',
        customerId: 'cust-1',
        createdAt: new Date(),
        items: [],
      });
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: null });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });

      await service.notifyOrderItemsOnHold('order-1', 'store-1');

      expect(userNotificationRepo.save).not.toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("metadata->>'orderId'"),
        expect.objectContaining({ meta_orderId: 'order-1' }),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining("metadata->>'storeId'"),
        expect.objectContaining({ meta_storeId: 'store-1' }),
      );
    });

    it('continues vendor notify when customer notification throws', async () => {
      mockNoDedupeHit();
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        orderNumber: 'ORD-HOLD-1',
        customerId: 'cust-1',
        createdAt: new Date(),
        items: [],
      });
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: null });
      storeRepo.findOne.mockResolvedValue({
        id: 'store-1',
        owner: { id: 'vendor-1' },
      });
      userNotificationRepo.save
        .mockRejectedValueOnce(new Error('fk boom'))
        .mockResolvedValueOnce({ id: 'vendor-notif' });

      await expect(service.notifyOrderItemsOnHold('order-1', 'store-1')).resolves.toBeUndefined();

      expect(userNotificationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'vendor_order_items_on_hold', userId: 'vendor-1' }),
      );
    });
  });
});
