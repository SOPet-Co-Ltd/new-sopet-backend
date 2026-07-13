import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from '../../database/entities/customer.entity';
import { Favorite } from '../../database/entities/favorite.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
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
});
