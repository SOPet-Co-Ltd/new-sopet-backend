import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource as TypeOrmDataSource, In, Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { Order } from '../../database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../../database/entities/order-item.entity';
import { OrderShippingAddress } from '../../database/entities/order-shipping-address.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { DataSource } from '../../database/entities/enums/data-source.enums';
import { OrderStatus, PaymentMethod } from '../../database/entities/enums/order.enums';
import { PaginatedResponse } from '../../common/interfaces';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { StoresService } from '../stores/stores.service';
import {
  CreateImportedAddressDto,
  CreateImportedCustomerDto,
} from './dto/create-imported-customer.dto';
import { CreateImportedOrderDto } from './dto/create-imported-order.dto';

export function mapImportedCustomer(customer: Customer) {
  return {
    id: customer.id,
    phone: customer.phone,
    fullName: customer.fullName,
    email: customer.email,
    externalId: customer.externalId,
    source: DataSource.VENDOR_IMPORT as const,
    createdAt: customer.createdAt,
  };
}

export function mapImportedAddress(address: SavedAddress) {
  return {
    id: address.id,
    customerId: address.customerId,
    fullName: address.fullName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    tumbon: address.tumbon,
    amphoe: address.amphoe,
    district: address.district,
    province: address.province,
    postalCode: address.postalCode,
    label: address.label,
    source: DataSource.VENDOR_IMPORT as const,
    createdAt: address.createdAt,
  };
}

export function mapImportedOrder(order: Order, storeId: string) {
  const items = (order.items ?? []).filter((item) => item.storeId === storeId);
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerId: order.customerId,
    placedAt: order.paidAt ?? order.createdAt,
    shippingFee: Number(order.shippingFee),
    subtotal: Number(order.subtotal),
    total: Number(order.total),
    notes: order.notes,
    source: DataSource.VENDOR_IMPORT as const,
    items: items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantId: item.variantId,
      sku: item.productVariant?.sku ?? null,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      subtotal: Number(item.subtotal),
    })),
    createdAt: order.createdAt,
  };
}

function buildImportOrderNumber(storeId: string, externalOrderNumber: string): string {
  const prefix = `VI-${storeId.replace(/-/g, '').slice(0, 8)}-`;
  const maxExternal = Math.max(1, 50 - prefix.length);
  const external = externalOrderNumber.trim().slice(0, maxExternal);
  return `${prefix}${external}`;
}

@Injectable()
export class ImportDataService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(SavedAddress)
    private readonly addressRepository: Repository<SavedAddress>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductVariant)
    private readonly variantRepository: Repository<ProductVariant>,
    private readonly storesService: StoresService,
    private readonly dataSource: TypeOrmDataSource,
  ) {}

  async createImportedCustomer(
    storeId: string,
    userId: string,
    dto: CreateImportedCustomerDto,
  ): Promise<Customer> {
    await this.storesService.assertStoreAccess(userId, storeId);

    // Store local 0-leading form so OTP login (findActiveByPhone) attaches to same row.
    const phone = normalizeThaiPhoneToLocal(dto.phone);
    let customer = await this.customerRepository.findOne({
      where: { phone: In(guestPhoneLookupValues(phone)) },
    });

    if (customer) {
      customer.importStoreId = storeId;
      customer.phone = phone;
      if (dto.externalId?.trim()) {
        customer.externalId = dto.externalId.trim();
      }
      if (!customer.fullName && dto.fullName.trim()) {
        customer.fullName = dto.fullName.trim();
      }
      if (!customer.email && dto.email?.trim()) {
        customer.email = dto.email.trim();
      }
      if (customer.source !== DataSource.PLATFORM) {
        customer.source = DataSource.VENDOR_IMPORT;
      }
      return this.customerRepository.save(customer);
    }

    customer = this.customerRepository.create({
      phone,
      fullName: dto.fullName.trim(),
      email: dto.email?.trim() || null,
      externalId: dto.externalId?.trim() || null,
      importStoreId: storeId,
      source: DataSource.VENDOR_IMPORT,
      isVerified: false,
      isActive: true,
    });
    return this.customerRepository.save(customer);
  }

  async listImportedCustomers(
    storeId: string,
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<Customer>> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const [items, total] = await this.customerRepository.findAndCount({
      where: { importStoreId: storeId, source: DataSource.VENDOR_IMPORT },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  async createImportedAddress(
    storeId: string,
    userId: string,
    customerId: string,
    dto: CreateImportedAddressDto,
  ): Promise<SavedAddress> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const customer = await this.requireImportedCustomer(storeId, customerId);

    const address = this.addressRepository.create({
      customerId: customer.id,
      fullName: dto.fullName.trim(),
      phone: normalizeThaiPhoneToLocal(dto.phone),
      addressLine1: dto.addressLine1.trim(),
      addressLine2: dto.addressLine2?.trim() || null,
      tumbon: dto.tumbon?.trim() || null,
      amphoe: dto.amphoe.trim(),
      district: dto.district.trim(),
      province: dto.province.trim(),
      postalCode: dto.postalCode.trim(),
      label: dto.label?.trim() || null,
      isDefault: false,
    });
    return this.addressRepository.save(address);
  }

  async listImportedAddresses(
    storeId: string,
    userId: string,
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<SavedAddress>> {
    await this.storesService.assertStoreAccess(userId, storeId);
    await this.requireImportedCustomer(storeId, customerId);

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [items, total] = await this.addressRepository.findAndCount({
      where: { customerId },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  /**
   * Seeds a historical order into live tables with source=vendor_import.
   * Does NOT decrement stock, create payments, or emit webhooks.
   */
  async createImportedOrder(
    storeId: string,
    userId: string,
    dto: CreateImportedOrderDto,
  ): Promise<Order> {
    await this.storesService.assertStoreAccess(userId, storeId);

    const orderNumber = buildImportOrderNumber(storeId, dto.externalOrderNumber);
    const existing = await this.orderRepository.findOne({ where: { orderNumber } });
    if (existing) {
      throw new ConflictException({
        code: 'IMPORTED_ORDER_CONFLICT',
        message: 'An imported order with this externalOrderNumber already exists for this store',
      });
    }

    let customer: Customer | null = null;
    if (dto.customerId) {
      customer = await this.requireImportedCustomer(storeId, dto.customerId);
    }

    const resolvedItems: Array<{
      variant: ProductVariant;
      productName: string;
      quantity: number;
      unitPrice: number;
      subtotal: number;
    }> = [];

    for (const item of dto.items) {
      const variant = await this.resolveVariant(storeId, item.productId, item.sku);
      if (!variant) {
        throw new BadRequestException({
          code: 'IMPORT_ITEM_UNRESOLVED',
          message: `Could not resolve product/sku for item "${item.productName}" — provide productId or sku for a product in this store`,
        });
      }
      const unitPrice = Number(item.unitPrice);
      const quantity = item.quantity;
      resolvedItems.push({
        variant,
        productName: item.productName.trim(),
        quantity,
        unitPrice,
        subtotal: Math.round(unitPrice * quantity * 100) / 100,
      });
    }

    const subtotal = resolvedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const shippingFee = Number(dto.shippingFee ?? 0);
    const total = Math.round((subtotal + shippingFee) * 100) / 100;
    const placedAt = new Date(dto.placedAt);
    if (Number.isNaN(placedAt.getTime())) {
      throw new BadRequestException({
        code: 'INVALID_PLACED_AT',
        message: 'placedAt must be a valid ISO date',
      });
    }

    const defaultAddress = customer
      ? await this.addressRepository.findOne({
          where: { customerId: customer.id },
          order: { createdAt: 'DESC' },
        })
      : null;

    return this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        orderNumber,
        customerId: customer?.id ?? null,
        guestPhone: customer?.phone ?? null,
        guestName: customer?.fullName ?? null,
        guestEmail: customer?.email ?? null,
        status: OrderStatus.DELIVERED,
        subtotal,
        discountAmount: 0,
        shippingFee,
        total,
        paymentMethod: PaymentMethod.COD,
        paymentReference: null,
        paidAt: placedAt,
        notes: dto.notes?.trim() || `Imported order ${dto.externalOrderNumber.trim()}`,
        source: DataSource.VENDOR_IMPORT,
        createdAt: placedAt,
        updatedAt: placedAt,
      });
      const savedOrder = await manager.save(Order, order);

      // Preserve historical placedAt (CreateDateColumn would otherwise overwrite on insert).
      await manager.update(Order, savedOrder.id, {
        createdAt: placedAt,
        updatedAt: placedAt,
        paidAt: placedAt,
      });

      const orderItems = resolvedItems.map((item) =>
        manager.create(OrderItem, {
          orderId: savedOrder.id,
          storeId,
          variantId: item.variant.id,
          productName: item.productName,
          variantOptions: item.variant.options ?? {},
          unitPrice: item.unitPrice,
          catalogUnitPrice: item.unitPrice,
          quantity: item.quantity,
          subtotal: item.subtotal,
          fulfillmentStatus: FulfillmentStatus.DELIVERED,
          deliveredAt: placedAt,
          createdAt: placedAt,
          updatedAt: placedAt,
        }),
      );
      await manager.save(OrderItem, orderItems);

      if (defaultAddress) {
        await manager.save(
          OrderShippingAddress,
          manager.create(OrderShippingAddress, {
            orderId: savedOrder.id,
            savedAddressId: defaultAddress.id,
            fullName: defaultAddress.fullName,
            phone: defaultAddress.phone,
            addressLine1: defaultAddress.addressLine1,
            addressLine2: defaultAddress.addressLine2,
            tumbon: defaultAddress.tumbon,
            amphoe: defaultAddress.amphoe,
            province: defaultAddress.province,
            postalCode: defaultAddress.postalCode,
          }),
        );
      }

      const withRelations = await manager.findOne(Order, {
        where: { id: savedOrder.id },
        relations: ['items', 'items.productVariant', 'customer', 'shippingAddress'],
      });
      return withRelations ?? savedOrder;
    });
  }

  async listImportedOrders(
    storeId: string,
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<Order>> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .innerJoinAndSelect('order.items', 'item', 'item.store_id = :storeId', { storeId })
      .leftJoinAndSelect('item.productVariant', 'variant')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('order.shippingAddress', 'shippingAddress')
      .where('order.source = :source', { source: DataSource.VENDOR_IMPORT })
      .orderBy('order.createdAt', 'DESC')
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit) || 1,
      },
    };
  }

  private async requireImportedCustomer(storeId: string, customerId: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer || customer.importStoreId !== storeId) {
      throw new NotFoundException({
        code: 'IMPORTED_CUSTOMER_NOT_FOUND',
        message: 'Imported customer not found for this store',
      });
    }
    return customer;
  }

  private async resolveVariant(
    storeId: string,
    productId?: string,
    sku?: string,
  ): Promise<ProductVariant | null> {
    if (sku?.trim()) {
      const variant = await this.variantRepository
        .createQueryBuilder('variant')
        .innerJoinAndSelect('variant.product', 'product')
        .where('variant.sku = :sku', { sku: sku.trim() })
        .andWhere('product.store_id = :storeId', { storeId })
        .andWhere('variant.deleted_at IS NULL')
        .getOne();
      if (variant) {
        return variant;
      }
    }

    if (productId) {
      const product = await this.productRepository.findOne({
        where: { id: productId, storeId },
        relations: ['variants'],
      });
      if (!product) {
        return null;
      }
      const variants = (product.variants ?? []).filter((v) => !v.deletedAt);
      if (variants.length === 0) {
        return null;
      }
      return variants[0];
    }

    return null;
  }
}
