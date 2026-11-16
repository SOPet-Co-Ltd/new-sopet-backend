import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
    query: jest.fn(),
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

  const ordersService = {
    mergeGuestOrders: jest.fn().mockResolvedValue(undefined),
  };

  const customCustomerRepo = {
    findOtherActiveByPhone: jest.fn().mockResolvedValue(null),
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
        { provide: OrdersService, useValue: ordersService },
        { provide: CustomerRepository, useValue: customCustomerRepo },
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

  describe('updateAsAdmin', () => {
    it('clears optional fields when null is sent and leaves omitted fields unchanged', async () => {
      const customer = {
        id: 'cust-1',
        phone: '0812345678',
        fullName: 'Old Name',
        email: 'old@example.com',
        dateOfBirth: '1990-01-01',
        isVerified: true,
      };
      customerRepo.findOne.mockResolvedValue(customer);

      const result = await service.updateAsAdmin({
        id: 'cust-1',
        email: null,
        dateOfBirth: null,
      });

      expect(result.email).toBeNull();
      expect(result.dateOfBirth).toBeNull();
      expect(result.fullName).toBe('Old Name');
      expect(result.isVerified).toBe(true);
    });

    it('unverifies customer when phone changes and merges guest orders', async () => {
      const customer = {
        id: 'cust-1',
        phone: '0812345678',
        fullName: 'Test',
        email: null,
        dateOfBirth: null,
        isVerified: true,
      };
      customerRepo.findOne.mockResolvedValue(customer);

      const result = await service.updateAsAdmin({
        id: 'cust-1',
        phone: '0899999999',
      });

      expect(result.phone).toBe('0899999999');
      expect(result.isVerified).toBe(false);
      expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0812345678');
      expect(ordersService.mergeGuestOrders).toHaveBeenCalledWith('cust-1', '0899999999');
    });
  });

  describe('verifyPhoneAsAdmin', () => {
    it('marks unverified customer as verified', async () => {
      const customer = { id: 'cust-1', phone: '0812345678', isVerified: false };
      customerRepo.findOne.mockResolvedValue(customer);

      const result = await service.verifyPhoneAsAdmin('cust-1');
      expect(result.isVerified).toBe(true);
    });

    it('throws when phone is already verified', async () => {
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        phone: '0812345678',
        isVerified: true,
      });

      await expect(service.verifyPhoneAsAdmin('cust-1')).rejects.toThrow(BadRequestException);
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

  describe('list pagination caps', () => {
    function mockListQuery(total: number, rows: Array<Record<string, unknown>> = []) {
      customerRepo.query.mockImplementation(async (sql: string) => {
        if (String(sql).includes('COUNT(*)')) {
          return [{ count: String(total) }];
        }
        return rows;
      });
    }

    function listQueryCall(): [string, unknown[]] | undefined {
      const calls = customerRepo.query.mock.calls as Array<[string, unknown[]]>;
      return calls.find((call) => !call[0].includes('COUNT(*)'));
    }

    it('clamps admin customer limit to 100 and uses it in the page math', async () => {
      mockListQuery(250, [
        {
          id: 'cust-1',
          phone: '0812345678',
          fullName: 'Ann',
          email: null,
          dateOfBirth: null,
          isVerified: true,
          isActive: true,
          lastLoginAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          isGuest: false,
        },
      ]);

      const result = await service.findAllForAdmin(2, 500);

      const listCall = listQueryCall();
      expect(listCall?.[1]).toEqual([null, 100, 100]);
      expect(listCall?.[0]).toContain('guest:');
      expect(result.pagination).toEqual({
        page: 2,
        limit: 100,
        total: 250,
        totalPages: 3,
      });
      expect(result.items[0]).toMatchObject({ id: 'cust-1', isGuest: false });
    });

    it('raises a non-positive admin limit to 1', async () => {
      mockListQuery(0);

      const result = await service.findAllForAdmin(1, 0);

      const listCall = listQueryCall();
      expect(listCall?.[1]).toEqual([null, 1, 0]);
      expect(result.pagination.limit).toBe(1);
    });

    it('maps unmatched guest buyers into the admin list', async () => {
      mockListQuery(1, [
        {
          id: 'guest:0811111111',
          phone: '0811111111',
          fullName: 'Guest Buyer',
          email: 'guest@example.com',
          dateOfBirth: null,
          isVerified: false,
          isActive: true,
          lastLoginAt: null,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-02T00:00:00.000Z',
          isGuest: true,
        },
      ]);

      const result = await service.findAllForAdmin(1, 20, '081111');

      const listCall = listQueryCall();
      expect(listCall?.[1][0]).toBe('%081111%');
      expect(listCall?.[0]).toContain('guest_phone');
      expect(result.items[0]).toMatchObject({
        id: 'guest:0811111111',
        fullName: 'Guest Buyer',
        isGuest: true,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('clamps vendor customer limit to 100', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'cust-1' }], 10]),
      };
      customerRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findForVendorStore('store-1', 1, 1000, 'ann');

      expect(qb.take).toHaveBeenCalledWith(100);
      expect(result.pagination.limit).toBe(100);
    });
  });
});
