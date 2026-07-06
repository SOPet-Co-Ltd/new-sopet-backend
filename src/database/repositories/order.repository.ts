import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In, Between, DataSource } from 'typeorm';
import { Order, OrderStatus, PaymentMethod } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderStatusHistory } from '../entities/order-status-history.entity';
import { OrderShippingAddress } from '../entities/order-shipping-address.entity';
import { ProductVariant } from '../entities/product-variant.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../entities/inventory-transaction.entity';

interface OrderFilters {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  fromDate?: Date;
  toDate?: Date;
}

interface CreateOrderData {
  customerId?: string;
  guestPhone?: string;
  guestName?: string;
  guestEmail?: string;
  subtotal: number;
  discountAmount: number;
  shippingFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  shippingAddress: {
    savedAddressId?: string | null;
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string | null;
    tumbon?: string | null;
    amphoe: string;
    province: string;
    postalCode: string;
  };
  notes?: string;
  items: Array<{
    storeId: string;
    variantId: string;
    productName: string;
    variantOptions: Record<string, string>;
    unitPrice: number;
    quantity: number;
  }>;
}

@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly repository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(OrderStatusHistory)
    private readonly historyRepository: Repository<OrderStatusHistory>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    @InjectRepository(InventoryTransaction)
    private readonly inventoryRepository: Repository<InventoryTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  async create(data: CreateOrderData): Promise<Order> {
    return this.dataSource.transaction(async (manager) => {
      // Generate order number
      const orderNumber = await this.generateOrderNumber();

      // Create order
      const order = manager.create(Order, {
        orderNumber,
        customerId: data.customerId || null,
        guestPhone: data.guestPhone || null,
        guestName: data.guestName || null,
        guestEmail: data.guestEmail || null,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal: data.subtotal,
        discountAmount: data.discountAmount,
        shippingFee: data.shippingFee,
        total: data.total,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
      });

      const savedOrder = await manager.save(order);

      await manager.save(
        OrderShippingAddress,
        manager.create(OrderShippingAddress, {
          orderId: savedOrder.id,
          savedAddressId: data.shippingAddress.savedAddressId ?? null,
          fullName: data.shippingAddress.fullName,
          phone: data.shippingAddress.phone,
          addressLine1: data.shippingAddress.addressLine1,
          addressLine2: data.shippingAddress.addressLine2 ?? null,
          tumbon: data.shippingAddress.tumbon ?? null,
          amphoe: data.shippingAddress.amphoe,
          province: data.shippingAddress.province,
          postalCode: data.shippingAddress.postalCode,
        }),
      );

      // Create order items
      const items = data.items.map((item) =>
        manager.create(OrderItem, {
          orderId: savedOrder.id,
          storeId: item.storeId,
          variantId: item.variantId,
          productName: item.productName,
          variantOptions: item.variantOptions,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.unitPrice * item.quantity,
        }),
      );

      await manager.save(OrderItem, items);

      // Update inventory
      for (const item of data.items) {
        const variant = await manager.findOne(ProductVariant, {
          where: { id: item.variantId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!variant) {
          throw new Error(`Variant ${item.variantId} not found`);
        }

        const newQuantity = variant.stockQuantity - item.quantity;

        if (newQuantity < 0) {
          throw new Error(`Insufficient stock for ${item.productName}`);
        }

        await manager.update(ProductVariant, item.variantId, {
          stockQuantity: newQuantity,
        });

        await manager.save(
          InventoryTransaction,
          manager.create(InventoryTransaction, {
            variantId: item.variantId,
            type: InventoryTransactionType.SALE,
            quantityChange: -item.quantity,
            quantityAfter: newQuantity,
            referenceId: savedOrder.id,
            referenceType: 'order',
          }),
        );
      }

      // Create status history
      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: savedOrder.id,
          status: OrderStatus.PENDING_PAYMENT,
        }),
      );

      const created = await this.findById(savedOrder.id);
      return created!;
    });
  }

  private async generateOrderNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');

    const count = await this.repository.count({
      where: {
        createdAt: Between(
          new Date(date.setHours(0, 0, 0, 0)),
          new Date(date.setHours(23, 59, 59, 999)),
        ),
      },
    });

    const sequence = (count + 1).toString().padStart(4, '0');
    return `ORD${year}${month}${day}${sequence}`;
  }

  async findById(id: string): Promise<Order | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['items', 'items.store', 'items.productVariant', 'customer', 'shippingAddress'],
    });
  }

  async findByOrderNumber(orderNumber: string): Promise<Order | null> {
    return this.repository.findOne({
      where: { orderNumber },
      relations: ['items', 'items.store', 'items.productVariant', 'customer', 'shippingAddress'],
    });
  }

  async findByCustomer(
    customerId: string,
    filters?: OrderFilters,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Order[]> {
    const query = this.repository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .where('order.customer_id = :customerId', { customerId })
      .orderBy('order.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    this.applyFilters(query, filters);

    return query.getMany();
  }

  async findByGuestPhone(
    guestPhone: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<Order[]> {
    return this.repository.find({
      where: { guestPhone },
      relations: ['items'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async findByStore(
    storeId: string,
    filters?: OrderFilters,
    limit: number = 20,
    offset: number = 0,
  ): Promise<OrderItem[]> {
    const query = this.orderItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.order', 'order')
      .leftJoinAndSelect('item.productVariant', 'variant')
      .where('item.store_id = :storeId', { storeId })
      .orderBy('item.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.status) {
      query.andWhere('order.status = :status', { status: filters.status });
    }

    if (filters?.fromDate) {
      query.andWhere('order.created_at >= :fromDate', { fromDate: filters.fromDate });
    }

    if (filters?.toDate) {
      query.andWhere('order.created_at <= :toDate', { toDate: filters.toDate });
    }

    return query.getMany();
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    userId?: string,
    notes?: string,
  ): Promise<Order | null> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(Order, id, { status });

      if (status === OrderStatus.PAID) {
        await manager.update(Order, id, { paidAt: new Date() });
      }

      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: id,
          status,
          changedBy: userId,
          notes,
        }),
      );
    });

    return this.findById(id);
  }

  async updatePaymentReference(id: string, reference: string): Promise<void> {
    await this.repository.update(id, { paymentReference: reference });
  }

  private applyFilters(query: any, filters?: OrderFilters): void {
    if (!filters) return;

    if (filters.status) {
      query.andWhere('order.status = :status', { status: filters.status });
    }

    if (filters.paymentMethod) {
      query.andWhere('order.payment_method = :paymentMethod', {
        paymentMethod: filters.paymentMethod,
      });
    }

    if (filters.fromDate) {
      query.andWhere('order.created_at >= :fromDate', { fromDate: filters.fromDate });
    }

    if (filters.toDate) {
      query.andWhere('order.created_at <= :toDate', { toDate: filters.toDate });
    }
  }
}
