import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EmailService } from '../email/email.service';
import { Customer } from '../../database/entities/customer.entity';
import { UserNotification } from '../../database/entities/user-notification.entity';
import { Store } from '../../database/entities/store.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationChannel } from '../../database/entities/notification.entity';
import { Order } from '../../database/entities/order.entity';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const emailService = {
    send: jest.fn(),
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: EmailService, useValue: emailService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        {
          provide: getRepositoryToken(UserNotification),
          useValue: userNotificationRepo,
        },
        { provide: getRepositoryToken(Store), useValue: storeRepo },
        { provide: getRepositoryToken(StoreRequest), useValue: storeRequestRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('notifyOrderPaid', () => {
    it('sends email when customer has email', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        total: 1500,
      } as Order;
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'user@example.com' });

      await service.notifyOrderPaid(order);

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('ORD-001'),
        }),
      );
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
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });

  describe('notifyOrderStatusChanged', () => {
    it('sends email', async () => {
      const order = {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'cust-1',
        guestEmail: null,
      } as Order;
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1', email: 'user@example.com' });

      await service.notifyOrderStatusChanged(order, 'SHIPPED');

      expect(emailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('ORD-001'),
        }),
      );
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
});
