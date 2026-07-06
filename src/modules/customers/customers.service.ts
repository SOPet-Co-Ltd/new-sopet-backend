import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { PaginatedResponse } from '../../common/interfaces';
import { UpdateCustomerAsAdminInput } from './customers.inputs';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
  ) {}

  async findAllForAdmin(
    page: number,
    limit: number,
    search?: string,
  ): Promise<PaginatedResponse<Customer>> {
    const skip = (page - 1) * limit;
    const qb = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.deleted_at IS NULL');

    if (search?.trim()) {
      qb.andWhere(
        '(customer.phone ILIKE :search OR customer.full_name ILIKE :search OR customer.email ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }

    const [items, total] = await qb
      .orderBy('customer.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findByIdForAdmin(id: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id },
    });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }
    return customer;
  }

  async updateAsAdmin(input: UpdateCustomerAsAdminInput): Promise<Customer> {
    const customer = await this.findByIdForAdmin(input.id);

    if (input.phone !== undefined && input.phone !== customer.phone) {
      const existing = await this.customerRepository.findOne({
        where: { phone: input.phone },
      });
      if (existing && existing.id !== customer.id) {
        throw new ConflictException({
          code: 'PHONE_ALREADY_EXISTS',
          message: 'Phone number is already in use',
        });
      }
      customer.phone = input.phone;
    }

    if (input.fullName !== undefined) {
      customer.fullName = input.fullName;
    }
    if (input.email !== undefined) {
      customer.email = input.email;
    }
    if (input.dateOfBirth !== undefined) {
      customer.dateOfBirth = input.dateOfBirth;
    }

    return this.customerRepository.save(customer);
  }

  async setActive(id: string, isActive: boolean): Promise<Customer> {
    const customer = await this.findByIdForAdmin(id);
    customer.isActive = isActive;
    return this.customerRepository.save(customer);
  }

  async findForVendorStore(
    storeId: string,
    page: number,
    limit: number,
    search?: string,
  ): Promise<PaginatedResponse<Customer>> {
    const skip = (page - 1) * limit;

    const qb = this.customerRepository
      .createQueryBuilder('customer')
      .where('customer.deleted_at IS NULL')
      .andWhere(
        `customer.id IN (
          SELECT DISTINCT o.customer_id
          FROM orders o
          INNER JOIN order_items oi ON oi.order_id = o.id
          WHERE oi.store_id = :storeId AND o.customer_id IS NOT NULL
        )`,
        { storeId },
      );

    if (search?.trim()) {
      qb.andWhere(
        '(customer.phone ILIKE :search OR customer.full_name ILIKE :search OR customer.email ILIKE :search)',
        { search: `%${search.trim()}%` },
      );
    }

    const [items, total] = await qb
      .orderBy('customer.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findByIdForVendor(storeId: string, customerId: string): Promise<Customer> {
    const purchaseCount = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'order')
      .where('oi.store_id = :storeId', { storeId })
      .andWhere('order.customer_id = :customerId', { customerId })
      .getCount();

    if (purchaseCount === 0) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Customer has not purchased from this store',
      });
    }

    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }
    return customer;
  }

  async customerHasPurchasedFromStore(storeId: string, customerId: string): Promise<boolean> {
    const count = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'order')
      .where('oi.store_id = :storeId', { storeId })
      .andWhere('order.customer_id = :customerId', { customerId })
      .getCount();
    return count > 0;
  }
}
