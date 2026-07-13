import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from '../../database/entities/customer.entity';
import { Favorite } from '../../database/entities/favorite.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Review } from '../../database/entities/review.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { OrdersService } from '../orders/orders.service';
import { CustomerRepository } from '../../database/repositories/customer.repository';

describe('CustomersService', () => {
  let service: CustomersService;

  const customerRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x: Customer) => x),
    createQueryBuilder: jest.fn(),
  };

  const orderItemRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
  };

  const orderRepo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
  };

  const savedAddressRepo = {
    count: jest.fn(),
  };

  const favoriteRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const reviewRepo = {
    createQueryBuilder: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: getRepositoryToken(SavedAddress), useValue: savedAddressRepo },
        { provide: getRepositoryToken(Favorite), useValue: favoriteRepo },
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: OrdersService, useValue: {} },
        { provide: CustomerRepository, useValue: {} },
      ],
    }).compile();

    service = module.get(CustomersService);
  });

  describe('findByIdForVendor', () => {
    it('throws Forbidden when customer has not purchased from store', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '0812345678',
      });
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      orderItemRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.findByIdForVendor('store-1', 'cust-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns customer when purchase exists via customer_id', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '0812345678',
        fullName: 'Test User',
      });
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      orderItemRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findByIdForVendor('store-1', 'cust-1');
      expect(result.id).toBe('cust-1');
    });

    it('throws NotFound when customer does not exist', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(service.findByIdForVendor('store-1', 'cust-missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('setActive', () => {
    it('updates isActive flag', async () => {
      const customer = { id: 'cust-1', isActive: true };
      customerRepo.findOne.mockResolvedValue(customer);

      const result = await service.setActive('cust-1', false);
      expect(result.isActive).toBe(false);
      expect(customerRepo.save).toHaveBeenCalled();
    });
  });

  describe('getInsightsForAdmin', () => {
    it('returns spend stats, counts, and recent orders', async () => {
      customerRepo.findOne.mockResolvedValue({ id: 'cust-1' });

      const statsQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          orderCount: '2',
          totalSpent: '1500.50',
          lastOrderAt: new Date('2026-01-15T10:00:00Z'),
        }),
      };
      orderRepo.createQueryBuilder.mockReturnValue(statsQb);
      savedAddressRepo.count.mockResolvedValue(3);
      favoriteRepo.count.mockResolvedValue(5);
      orderRepo.find.mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: 'paid',
          total: 1000,
          createdAt: new Date('2026-01-15T10:00:00Z'),
          items: [
            {
              productName: 'Dog Food',
              quantity: 2,
              unitPrice: 250,
              subtotal: 500,
            },
          ],
        },
      ]);

      const result = await service.getInsightsForAdmin('cust-1');

      expect(result.totalSpent).toBe(1500.5);
      expect(result.orderCount).toBe(2);
      expect(result.averageOrderValue).toBe(750.25);
      expect(result.addressCount).toBe(3);
      expect(result.favoriteCount).toBe(5);
      expect(result.recentOrders).toHaveLength(1);
      expect(result.recentOrders[0].items[0].productName).toBe('Dog Food');
    });

    it('throws NotFound when customer does not exist', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(service.getInsightsForAdmin('cust-missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInsightsForVendorStore', () => {
    function mockVendorAccess() {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '0812345678',
      });
      const purchaseQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      };
      orderItemRepo.createQueryBuilder.mockReturnValueOnce(purchaseQb);
    }

    it('returns store-scoped spend stats, counts, and recent activity', async () => {
      mockVendorAccess();

      const statsQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({
          orderCount: '2',
          totalSpent: '900',
          lastOrderAt: new Date('2026-01-15T10:00:00Z'),
        }),
      };
      const recentOrdersQb = {
        innerJoin: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        distinct: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'order-1',
            orderNumber: 'ORD-001',
            status: 'paid',
            createdAt: new Date('2026-01-15T10:00:00Z'),
          },
        ]),
      };
      orderItemRepo.createQueryBuilder.mockReturnValueOnce(statsQb);
      orderRepo.createQueryBuilder.mockReturnValue(recentOrdersQb);
      orderItemRepo.find.mockResolvedValue([
        {
          orderId: 'order-1',
          storeId: 'store-1',
          productName: 'Dog Food',
          quantity: 2,
          unitPrice: 250,
          subtotal: 500,
        },
      ]);

      const favoriteCountQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };
      const reviewCountQb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(1),
      };
      const recentReviewsQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'review-1',
            rating: 5,
            comment: 'ดีมาก',
            createdAt: new Date('2026-01-10T10:00:00Z'),
            product: { name: 'Dog Food' },
          },
        ]),
      };
      const favoriteProductsQb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-01-05T10:00:00Z'),
            product: { name: 'Cat Treats' },
          },
        ]),
      };

      favoriteRepo.createQueryBuilder
        .mockReturnValueOnce(favoriteCountQb)
        .mockReturnValueOnce(favoriteProductsQb);
      reviewRepo.createQueryBuilder
        .mockReturnValueOnce(reviewCountQb)
        .mockReturnValueOnce(recentReviewsQb);

      const result = await service.getInsightsForVendorStore('store-1', 'cust-1');

      expect(recentOrdersQb.orderBy).toHaveBeenCalledWith('order.createdAt', 'DESC');
      expect(recentReviewsQb.orderBy).toHaveBeenCalledWith('review.createdAt', 'DESC');
      expect(favoriteProductsQb.orderBy).toHaveBeenCalledWith('favorite.createdAt', 'DESC');
      expect(result.totalSpent).toBe(900);
      expect(result.orderCount).toBe(2);
      expect(result.averageOrderValue).toBe(450);
      expect(result.favoriteCount).toBe(2);
      expect(result.reviewCount).toBe(1);
      expect(result.recentOrders).toHaveLength(1);
      expect(result.recentOrders[0].total).toBe(500);
      expect(result.recentOrders[0].items[0].productName).toBe('Dog Food');
      expect(result.recentReviews[0].productName).toBe('Dog Food');
      expect(result.favoriteProducts[0].productName).toBe('Cat Treats');
    });

    it('throws Forbidden when customer has not purchased from store', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '0812345678',
      });
      const qb = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };
      orderItemRepo.createQueryBuilder.mockReturnValue(qb);

      await expect(service.getInsightsForVendorStore('store-1', 'cust-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
