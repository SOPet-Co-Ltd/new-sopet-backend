import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from '../../database/entities/customer.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
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
});
