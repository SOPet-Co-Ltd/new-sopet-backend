import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderShippingAddress } from '../../database/entities/order-shipping-address.entity';
import { OrderStoreShipping } from '../../database/entities/order-store-shipping.entity';
import { OrderStatusHistory } from '../../database/entities/order-status-history.entity';
import { SavedAddress } from '../../database/entities/saved-address.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { Product } from '../../database/entities/product.entity';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';
import { PromotionUsage } from '../../database/entities/promotion-usage.entity';
import { Promotion } from '../../database/entities/promotion.entity';
import {
  InventoryTransaction,
  InventoryTransactionType,
} from '../../database/entities/inventory-transaction.entity';
import { CreateOrderDto, ShippingAddressDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PromotionsService, PromotionCartLine } from '../promotions/promotions.service';
import { GuestOrderLinkService } from './guest-order-link.service';
import { InventoryService } from '../inventory/inventory.service';
import { CartService } from '../cart/cart.service';
import { Store } from '../../database/entities/store.entity';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';
import { guestPhoneLookupValues, normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { PaginatedResponse } from '../../common/interfaces';
import {
  applyCustomerOrderListFilter,
  CustomerOrderListFilter,
  normalizeCustomerOrdersLimit,
  normalizeCustomerOrdersPage,
} from './order-list-filter.util';
export interface StoreShippingSelection {
  storeId: string;
  shippingOptionId: string;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemRepository: Repository<OrderItem>,
    @InjectRepository(SavedAddress)
    private savedAddressRepository: Repository<SavedAddress>,
    @InjectRepository(ProductVariant)
    private variantRepository: Repository<ProductVariant>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(StoreShippingOption)
    private shippingOptionRepository: Repository<StoreShippingOption>,
    private dataSource: DataSource,
    private notificationsService: NotificationsService,
    private promotionsService: PromotionsService,
    private guestOrderLinkService: GuestOrderLinkService,
    private inventoryService: InventoryService,
    private cartService: CartService,
    @InjectRepository(Store)
    private storeRepository: Repository<Store>,
  ) {}

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${timestamp}-${random}`;
  }

  private resolveAmphoe(shippingAddress: ShippingAddressDto): string {
    return shippingAddress.amphoe || shippingAddress.city || '';
  }

  private async resolveShippingSnapshot(
    customerId: string | undefined,
    createOrderDto: CreateOrderDto,
  ): Promise<Partial<OrderShippingAddress>> {
    const { savedAddressId, shippingAddress } = createOrderDto;

    if (!savedAddressId && !shippingAddress) {
      throw new BadRequestException({
        code: 'SHIPPING_ADDRESS_REQUIRED',
        message: 'Either savedAddressId or shippingAddress is required',
      });
    }

    if (savedAddressId) {
      if (!customerId) {
        throw new BadRequestException({
          code: 'SAVED_ADDRESS_REQUIRES_LOGIN',
          message: 'Saved addresses require a logged-in customer',
        });
      }

      const savedAddress = await this.savedAddressRepository.findOne({
        where: { id: savedAddressId, customerId },
      });

      if (!savedAddress) {
        throw new NotFoundException({
          code: 'SAVED_ADDRESS_NOT_FOUND',
          message: 'Saved address not found',
        });
      }

      return {
        savedAddressId: savedAddress.id,
        fullName: savedAddress.fullName,
        phone: savedAddress.phone,
        addressLine1: savedAddress.addressLine1,
        addressLine2: savedAddress.addressLine2,
        tumbon: savedAddress.tumbon,
        amphoe: savedAddress.amphoe,
        province: savedAddress.province,
        postalCode: savedAddress.postalCode,
      };
    }

    const amphoe = this.resolveAmphoe(shippingAddress!);
    if (!amphoe) {
      throw new BadRequestException({
        code: 'INVALID_SHIPPING_ADDRESS',
        message: 'amphoe is required',
      });
    }

    return {
      savedAddressId: null,
      fullName: shippingAddress!.recipientName,
      phone: normalizeThaiPhoneToLocal(shippingAddress!.recipientPhone),
      addressLine1: shippingAddress!.addressLine1,
      addressLine2: shippingAddress!.addressLine2 ?? null,
      tumbon: shippingAddress!.tumbon ?? null,
      amphoe,
      province: shippingAddress!.province,
      postalCode: shippingAddress!.postalCode,
    };
  }

  private async resolveStoreShipping(
    storeIds: string[],
    selections?: StoreShippingSelection[],
  ): Promise<{ fee: number; records: Partial<OrderStoreShipping>[] }> {
    if (!selections?.length) {
      return { fee: 0, records: [] };
    }

    const records: Partial<OrderStoreShipping>[] = [];
    let fee = 0;

    for (const storeId of storeIds) {
      const selection = selections.find((s) => s.storeId === storeId);
      if (!selection) {
        throw new BadRequestException({
          code: 'SHIPPING_OPTION_REQUIRED',
          message: `Shipping option required for store ${storeId}`,
        });
      }

      const option = await this.shippingOptionRepository.findOne({
        where: { id: selection.shippingOptionId, storeId, isActive: true },
      });

      if (!option) {
        throw new BadRequestException({
          code: 'INVALID_SHIPPING_OPTION',
          message: `Invalid shipping option for store ${storeId}`,
        });
      }

      fee += Number(option.price);
      records.push({
        storeId,
        shippingOptionId: option.id,
        optionName: option.name,
        shippingFee: Number(option.price),
      });
    }

    return { fee, records };
  }

  async create(createOrderDto: CreateOrderDto, customerId?: string): Promise<Order> {
    const {
      items,
      notes,
      paymentMethod,
      promotionCode,
      platformPromotionCode,
      storePromotionCodes,
      storeShipping,
      guestPhone,
      guestName,
      guestEmail,
    } = createOrderDto;

    const normalizedGuestPhone = guestPhone ? normalizeThaiPhoneToLocal(guestPhone) : undefined;
    const normalizedPaymentMethod = normalizeCheckoutPaymentMethod(paymentMethod);

    if (!customerId && !normalizedGuestPhone) {
      throw new BadRequestException({
        code: 'GUEST_PHONE_REQUIRED',
        message: 'Guest checkout requires guestPhone',
      });
    }

    const shippingSnapshot = await this.resolveShippingSnapshot(customerId, createOrderDto);

    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const storeSubtotals = new Map<string, number>();
    const promotionLines: PromotionCartLine[] = [];

    for (const item of items) {
      if (!item.variantId) {
        throw new BadRequestException({
          code: 'VARIANT_REQUIRED',
          message: 'A variantId is required for each order item',
        });
      }
      const variant = await this.variantRepository.findOne({
        where: { id: item.variantId },
        relations: ['product'],
      });
      if (!variant?.product) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant ${item.variantId} not found`,
        });
      }
      const storeId = variant.product.storeId;
      storeSubtotals.set(storeId, (storeSubtotals.get(storeId) ?? 0) + item.price * item.quantity);
      promotionLines.push({
        productId: variant.productId,
        variantId: variant.id,
        quantity: item.quantity,
        unitPrice: item.price,
        storeId,
      });
    }

    const storeIds = [...storeSubtotals.keys()];
    const { fee: shippingFee, records: shippingRecords } = await this.resolveStoreShipping(
      storeIds,
      storeShipping,
    );

    let discountAmount = 0;
    let appliedPromotions: Promotion[] = [];
    let discountsByPromotionId: Record<string, number> = {};

    const codes = storePromotionCodes ?? (promotionCode ? [promotionCode] : []);
    if (platformPromotionCode || codes.length) {
      const stacked = await this.promotionsService.applyStackedPromotions(
        subtotal,
        storeSubtotals,
        platformPromotionCode,
        codes,
        customerId
          ? { customerId }
          : normalizedGuestPhone
            ? { guestPhone: normalizedGuestPhone }
            : undefined,
        { mode: 'apply', lines: promotionLines },
      );
      discountAmount = stacked.discountAmount;
      appliedPromotions = stacked.promotions;
      discountsByPromotionId = stacked.discountsByPromotionId;
    }

    const total = subtotal + shippingFee - discountAmount;

    const orderId = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        orderNumber: this.generateOrderNumber(),
        customerId: customerId ?? null,
        guestPhone: normalizedGuestPhone ?? null,
        guestName: guestName ?? null,
        guestEmail: guestEmail ?? null,
        status: OrderStatus.PENDING_PAYMENT,
        subtotal,
        shippingFee,
        discountAmount,
        total,
        notes,
        paymentMethod: normalizedPaymentMethod as PaymentMethod,
      });

      const savedOrder = await manager.save(order);

      await manager.save(
        OrderShippingAddress,
        manager.create(OrderShippingAddress, {
          orderId: savedOrder.id,
          ...shippingSnapshot,
        }),
      );

      for (const record of shippingRecords) {
        await manager.save(
          OrderStoreShipping,
          manager.create(OrderStoreShipping, {
            orderId: savedOrder.id,
            ...record,
          }),
        );
      }

      const orderItems: OrderItem[] = [];
      for (const item of items) {
        const variant = await manager.findOne(ProductVariant, {
          where: { id: item.variantId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!variant) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_FOUND',
            message: `Variant ${item.variantId} not found`,
          });
        }

        const newStock = variant.stockQuantity - item.quantity;
        if (newStock < 0) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for variant ${item.variantId}`,
          });
        }

        await manager.update(ProductVariant, variant.id, {
          stockQuantity: newStock,
        });

        await manager.save(
          InventoryTransaction,
          manager.create(InventoryTransaction, {
            variantId: variant.id,
            type: InventoryTransactionType.SALE,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
            referenceId: savedOrder.id,
            referenceType: 'order',
          }),
        );

        const product =
          variant.product ??
          (await manager.findOne(Product, {
            where: { id: variant.productId },
          }));

        orderItems.push(
          manager.create(OrderItem, {
            orderId: savedOrder.id,
            storeId: product.storeId,
            variantId: variant.id,
            productName: product.name,
            variantOptions: variant.options ?? {},
            unitPrice: item.price,
            quantity: item.quantity,
            subtotal: item.price * item.quantity,
          }),
        );
      }

      await manager.save(OrderItem, orderItems);

      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: savedOrder.id,
          status: OrderStatus.PENDING_PAYMENT,
        }),
      );

      for (const promotion of appliedPromotions) {
        const promoDiscount = discountsByPromotionId[promotion.id] ?? 0;

        await manager.save(
          PromotionUsage,
          manager.create(PromotionUsage, {
            promotionId: promotion.id,
            orderId: savedOrder.id,
            discountAmount: promoDiscount,
          }),
        );
        await manager.increment(Promotion, { id: promotion.id }, 'usageCount', 1);
      }

      // Notify each vendor once per store (not once per line item)
      savedOrder.items = orderItems;
      this.notificationsService.notifyVendorsAboutNewOrder(savedOrder).catch(() => {});

      return savedOrder.id;
    });

    if (createOrderDto.cartItemIds?.length) {
      await this.cartService.removeItems(
        createOrderDto.cartItemIds,
        customerId,
        createOrderDto.sessionId,
      );
    }

    return this.findOne(orderId);
  }

  async findOne(id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: [
        'customer',
        'items',
        'items.productVariant',
        'items.productVariant.product',
        'items.productVariant.product.images',
        'shippingAddress',
        'storeShippings',
        'statusHistory',
      ],
      // Soft-deleted variants remain joinable for extras (image / productId); options use snapshot.
      withDeleted: true,
    });

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    return order;
  }

  async findOneWithItems(id: string): Promise<Order | null> {
    return this.orderRepository.findOne({
      where: { id },
      relations: ['items'],
    });
  }

  async findByCustomer(customerId: string): Promise<Order[]> {
    return this.orderRepository.find({
      where: { customerId },
      relations: ['items', 'items.productVariant', 'shippingAddress', 'storeShippings'],
      order: { createdAt: 'DESC' },
      withDeleted: true,
    });
  }

  async findByCustomerPaginated(
    customerId: string,
    options: {
      page?: number;
      limit?: number;
      filter?: CustomerOrderListFilter;
    } = {},
  ): Promise<PaginatedResponse<Order>> {
    const page = normalizeCustomerOrdersPage(options.page);
    const limit = normalizeCustomerOrdersLimit(options.limit);
    const filter = options.filter ?? CustomerOrderListFilter.ALL;
    const offset = (page - 1) * limit;

    const query = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .where('order.customerId = :customerId', { customerId })
      .orderBy('order.createdAt', 'DESC');

    applyCustomerOrderListFilter(query, filter);

    const [items, total] = await query.skip(offset).take(limit).getManyAndCount();

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

  async findLatestPurchaseProductId(customerId: string): Promise<string | null> {
    const row = await this.orderRepository
      .createQueryBuilder('order')
      .withDeleted()
      .innerJoin('order.items', 'item')
      .innerJoin('item.productVariant', 'variant')
      .select('variant.productId', 'productId')
      .where('order.customerId = :customerId', { customerId })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('item.createdAt', 'ASC')
      .limit(1)
      .getRawOne<{ productId: string }>();

    return row?.productId ?? null;
  }

  async findLatestPurchaseProductIds(customerId: string, limit: number): Promise<string[]> {
    const rows = await this.orderRepository
      .createQueryBuilder('order')
      .withDeleted()
      .innerJoin('order.items', 'item')
      .innerJoin('item.productVariant', 'variant')
      .select('variant.productId', 'productId')
      .where('order.customerId = :customerId', { customerId })
      .orderBy('order.createdAt', 'DESC')
      .addOrderBy('item.createdAt', 'ASC')
      .getRawMany<{ productId: string }>();

    const productIds: string[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (row.productId && !seen.has(row.productId)) {
        seen.add(row.productId);
        productIds.push(row.productId);
        if (productIds.length >= limit) {
          break;
        }
      }
    }

    return productIds;
  }

  async findByOrderNumber(orderNumber: string): Promise<Order> {
    const trimmedOrderNumber = orderNumber.trim();

    if (!trimmedOrderNumber) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const order = await this.orderRepository.findOne({
      where: { orderNumber: trimmedOrderNumber },
      relations: [
        'items',
        'items.productVariant',
        'items.productVariant.product',
        'items.productVariant.product.images',
        'storeShippings',
      ],
      withDeleted: true,
    });

    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    return order;
  }

  async findByGuestPhone(guestPhone: string): Promise<Order[]> {
    const lookupValues = guestPhoneLookupValues(guestPhone);

    return this.orderRepository.find({
      where: { guestPhone: In(lookupValues) },
      relations: ['items', 'shippingAddress', 'storeShippings'],
      order: { createdAt: 'DESC' },
    });
  }

  async mergeGuestOrders(customerId: string, phone: string): Promise<number> {
    return this.guestOrderLinkService.mergeGuestOrders(customerId, phone);
  }

  async findByStore(storeId: string): Promise<Order[]> {
    return this.orderRepository
      .createQueryBuilder('order')
      .innerJoin('order.items', 'item', 'item.storeId = :storeId', { storeId })
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.shippingAddress', 'shippingAddress')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('order.storeShippings', 'storeShippings')
      .orderBy('order.createdAt', 'DESC')
      .getMany();
  }

  async updateStatus(id: string, status: OrderStatus, userId?: string): Promise<Order> {
    const order = await this.findOne(id);
    const previousStatus = order.status;

    order.status = status;

    await this.dataSource.transaction(async (manager) => {
      if (status === OrderStatus.PAID) {
        order.paidAt = new Date();
      }
      await manager.save(order);

      if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) {
        await this.inventoryService.restoreOrderStock(
          id,
          manager,
          `Order status changed to ${status}`,
        );
      }

      await manager.save(
        OrderStatusHistory,
        manager.create(OrderStatusHistory, {
          orderId: id,
          status,
          changedBy: userId ?? null,
          notes: `Status changed from ${previousStatus} to ${status}`,
        }),
      );
    });

    const saved = await this.findOne(id);
    await this.notificationsService.notifyOrderStatusChanged(saved, status);
    this.notificationsService.notifyVendorsAboutOrderStatus(saved, status).catch(() => {});

    return saved;
  }
}
