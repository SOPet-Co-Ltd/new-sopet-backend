import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { Favorite } from '../../database/entities/favorite.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Review } from '../../database/entities/review.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { PaginatedResponse } from '../../common/interfaces';
import { UpdateCustomerAsAdminInput } from './customers.inputs';
import { OrdersService } from '../orders/orders.service';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';

const CUSTOMER_SPEND_EXCLUDED_STATUSES = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.PENDING_PAYMENT,
];

export type AdminCustomerInsightsResult = {
  totalSpent: number;
  orderCount: number;
  averageOrderValue: number;
  lastOrderAt: Date | null;
  addressCount: number;
  favoriteCount: number;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    total: number;
    createdAt: Date;
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }>;
  }>;
};

export type VendorCustomerStoreInsightsResult = {
  totalSpent: number;
  orderCount: number;
  averageOrderValue: number;
  lastOrderAt: Date | null;
  favoriteCount: number;
  reviewCount: number;
  recentOrders: AdminCustomerInsightsResult['recentOrders'];
  recentReviews: Array<{
    id: string;
    productName: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
  }>;
  favoriteProducts: Array<{
    productName: string;
    createdAt: Date;
  }>;
};

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(SavedAddress)
    private readonly savedAddressRepository: Repository<SavedAddress>,
    @InjectRepository(Favorite)
    private readonly favoriteRepository: Repository<Favorite>,
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
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

  async getInsightsForAdmin(customerId: string): Promise<AdminCustomerInsightsResult> {
    await this.findByIdForAdmin(customerId);

    const statsResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('COUNT(order.id)', 'orderCount')
      .addSelect('COALESCE(SUM(order.total), 0)', 'totalSpent')
      .addSelect('MAX(order.createdAt)', 'lastOrderAt')
      .where('order.customerId = :customerId', { customerId })
      .andWhere('order.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: CUSTOMER_SPEND_EXCLUDED_STATUSES,
      })
      .getRawOne<{ orderCount: string; totalSpent: string; lastOrderAt: Date | null }>();

    const orderCount = Number(statsResult?.orderCount ?? 0);
    const totalSpent = Number(statsResult?.totalSpent ?? 0);
    const averageOrderValue = orderCount > 0 ? totalSpent / orderCount : 0;

    const [addressCount, favoriteCount, recentOrders] = await Promise.all([
      this.savedAddressRepository.count({ where: { customerId } }),
      this.favoriteRepository.count({ where: { customerId } }),
      this.orderRepository.find({
        where: { customerId },
        relations: ['items'],
        order: { createdAt: 'DESC' },
        take: 10,
      }),
    ]);

    return {
      totalSpent,
      orderCount,
      averageOrderValue,
      lastOrderAt: statsResult?.lastOrderAt ?? null,
      addressCount,
      favoriteCount,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        createdAt: order.createdAt,
        items: (order.items ?? []).map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          subtotal: Number(item.subtotal),
        })),
      })),
    };
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

  async getInsightsForVendorStore(
    storeId: string,
    customerId: string,
  ): Promise<VendorCustomerStoreInsightsResult> {
    const customer = await this.findByIdForVendor(storeId, customerId);
    const phoneVariants = guestPhoneLookupValues(normalizeThaiPhoneToLocal(customer.phone));

    const statsQb = this.orderItemRepository
      .createQueryBuilder('oi')
      .select('COUNT(DISTINCT order.id)', 'orderCount')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'totalSpent')
      .addSelect('MAX(order.createdAt)', 'lastOrderAt')
      .innerJoin('oi.order', 'order')
      .where('oi.store_id = :storeId', { storeId });

    this.applyVendorCustomerOrderMatch(statsQb, customerId, phoneVariants);
    statsQb.andWhere('order.status NOT IN (:...excludedStatuses)', {
      excludedStatuses: CUSTOMER_SPEND_EXCLUDED_STATUSES,
    });

    const statsResult = await statsQb.getRawOne<{
      orderCount: string;
      totalSpent: string;
      lastOrderAt: Date | null;
    }>();

    const orderCount = Number(statsResult?.orderCount ?? 0);
    const totalSpent = Number(statsResult?.totalSpent ?? 0);
    const averageOrderValue = orderCount > 0 ? totalSpent / orderCount : 0;

    const recentOrdersQb = this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.items', 'oi', 'oi.store_id = :storeId', { storeId })
      .orderBy('order.createdAt', 'DESC')
      .distinct(true)
      .take(10);

    this.applyVendorCustomerOrderMatch(recentOrdersQb, customerId, phoneVariants);

    const [favoriteCount, reviewCount, recentOrders, recentReviews, favoriteProducts] =
      await Promise.all([
        this.favoriteRepository
          .createQueryBuilder('favorite')
          .innerJoin('favorite.product', 'product')
          .where('favorite.customer_id = :customerId', { customerId })
          .andWhere('product.store_id = :storeId', { storeId })
          .getCount(),
        this.reviewRepository
          .createQueryBuilder('review')
          .innerJoin('review.product', 'product')
          .where('review.customer_id = :customerId', { customerId })
          .andWhere('product.store_id = :storeId', { storeId })
          .andWhere('review.deleted_at IS NULL')
          .getCount(),
        recentOrdersQb.getMany(),
        this.reviewRepository
          .createQueryBuilder('review')
          .innerJoinAndSelect('review.product', 'product')
          .where('review.customer_id = :customerId', { customerId })
          .andWhere('product.store_id = :storeId', { storeId })
          .andWhere('review.deleted_at IS NULL')
          .orderBy('review.createdAt', 'DESC')
          .take(5)
          .getMany(),
        this.favoriteRepository
          .createQueryBuilder('favorite')
          .innerJoinAndSelect('favorite.product', 'product')
          .where('favorite.customer_id = :customerId', { customerId })
          .andWhere('product.store_id = :storeId', { storeId })
          .orderBy('favorite.createdAt', 'DESC')
          .take(5)
          .getMany(),
      ]);

    const orderIds = recentOrders.map((order) => order.id);
    const storeItems =
      orderIds.length > 0
        ? await this.orderItemRepository.find({
            where: { orderId: In(orderIds), storeId },
          })
        : [];

    const itemsByOrderId = new Map<string, OrderItem[]>();
    for (const item of storeItems) {
      const existing = itemsByOrderId.get(item.orderId) ?? [];
      existing.push(item);
      itemsByOrderId.set(item.orderId, existing);
    }

    return {
      totalSpent,
      orderCount,
      averageOrderValue,
      lastOrderAt: statsResult?.lastOrderAt ?? null,
      favoriteCount,
      reviewCount,
      recentOrders: recentOrders.map((order) => {
        const items = itemsByOrderId.get(order.id) ?? [];
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: items.reduce((sum, item) => sum + Number(item.subtotal), 0),
          createdAt: order.createdAt,
          items: items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            subtotal: Number(item.subtotal),
          })),
        };
      }),
      recentReviews: recentReviews.map((review) => ({
        id: review.id,
        productName: review.product?.name ?? 'สินค้า',
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      })),
      favoriteProducts: favoriteProducts.map((favorite) => ({
        productName: favorite.product?.name ?? 'สินค้า',
        createdAt: favorite.createdAt,
      })),
    };
  }

  private applyVendorCustomerOrderMatch<T extends { andWhere: (...args: unknown[]) => T }>(
    qb: T,
    customerId: string,
    phoneVariants: string[],
    orderAlias = 'order',
  ): T {
    return qb.andWhere(
      new Brackets((where) => {
        where.where(`${orderAlias}.customer_id = :customerId`, { customerId });
        if (phoneVariants.length > 0) {
          where.orWhere(
            `(${orderAlias}.customer_id IS NULL AND ${orderAlias}.guest_phone IN (:...phoneVariants))`,
            { phoneVariants },
          );
        }
      }),
    );
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
