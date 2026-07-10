import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { PaginatedResponse } from '../../common/interfaces';
import { UpdateCustomerAsAdminInput } from './customers.inputs';
import { OrdersService } from '../orders/orders.service';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly ordersService: OrdersService,
    private readonly customerRepo: CustomerRepository,
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
    const oldPhone = customer.phone;
    let phoneChanged = false;

    if (input.phone !== undefined) {
      const normalizedPhone = normalizeThaiPhoneToLocal(input.phone);
      if (normalizedPhone !== normalizeThaiPhoneToLocal(customer.phone)) {
        const existing = await this.customerRepo.findOtherActiveByPhone(
          normalizedPhone,
          customer.id,
        );
        if (existing) {
          throw new ConflictException({
            code: 'PHONE_ALREADY_EXISTS',
            message: 'Phone number is already in use',
          });
        }
        customer.phone = normalizedPhone;
        phoneChanged = true;
      }
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

    const saved = await this.customerRepository.save(customer);

    if (phoneChanged) {
      await this.ordersService.mergeGuestOrders(saved.id, oldPhone);
      await this.ordersService.mergeGuestOrders(saved.id, saved.phone);
    }

    return saved;
  }

  async setActive(id: string, isActive: boolean): Promise<Customer> {
    const customer = await this.findByIdForAdmin(id);
    customer.isActive = isActive;
    return this.customerRepository.save(customer);
  }

  private storePurchaserExistsClause(): string {
    return `EXISTS (
      SELECT 1
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE oi.store_id = :storeId
        AND (
          o.customer_id = customer.id
          OR (
            o.customer_id IS NULL
            AND o.guest_phone IS NOT NULL
            AND (
              customer.phone = o.guest_phone
              OR customer.phone = CONCAT('+66', SUBSTRING(o.guest_phone FROM 2))
              OR o.guest_phone = CONCAT('+66', SUBSTRING(customer.phone FROM 2))
            )
          )
        )
    )`;
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
      .andWhere(this.storePurchaserExistsClause(), { storeId });

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
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }

    const hasPurchased = await this.customerHasPurchasedFromStore(storeId, customerId);
    if (!hasPurchased) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Customer has not purchased from this store',
      });
    }

    return customer;
  }

  async customerHasPurchasedFromStore(storeId: string, customerId: string): Promise<boolean> {
    const customer = await this.customerRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) {
      return false;
    }

    const phoneVariants = guestPhoneLookupValues(normalizeThaiPhoneToLocal(customer.phone));
    const qb = this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'order')
      .where('oi.store_id = :storeId', { storeId })
      .andWhere(
        new Brackets((where) => {
          where.where('order.customer_id = :customerId', { customerId });
          if (phoneVariants.length > 0) {
            where.orWhere(
              '(order.customer_id IS NULL AND order.guest_phone IN (:...phoneVariants))',
              { phoneVariants },
            );
          }
        }),
      );

    const count = await qb.getCount();
    return count > 0;
  }
}
