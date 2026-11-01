import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { Customer } from '../../database/entities/customer.entity';
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
import { DashboardEventsService } from '../dashboard-events/dashboard-events.service';
import { DashboardActivityKind } from '../dashboard-events/dashboard-activity.constants';
import { PromotionsService, PromotionCartLine } from '../promotions/promotions.service';
import { GuestOrderLinkService } from './guest-order-link.service';
import { CustomerRepository } from '../../database/repositories/customer.repository';
import { InventoryService } from '../inventory/inventory.service';
import { CartService } from '../cart/cart.service';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';
import { normalizeThaiPhoneToLocal } from '../../common/utils/phone.util';
import { issueGuestPayToken } from '../../common/utils/guest-pay-token.util';
import { PaginatedResponse } from '../../common/interfaces';
import {
  applyCustomerOrderListFilter,
  CustomerOrderListFilter,
  normalizeCustomerOrdersLimit,
  normalizeCustomerOrdersPage,
} from './order-list-filter.util';
import { assertNotManualHoldTransition } from './store-suspension-hold.service';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { webhookEventForOrderStatus } from '../vendor-webhooks/vendor-webhook.events';
import { SaleCampaignPricingService } from '../sale-campaigns/sale-campaign-pricing.service';
import { roundMoney } from '../sale-campaigns/sale-campaign-pricing';
import { OrderAuditLogsService } from '../order-audit-logs/order-audit-logs.service';
import {
  OrderAuditActorType,
  OrderAuditEventType,
} from '../order-audit-logs/order-audit-log.constants';

export interface StoreShippingSelection {
  storeId: string;
  shippingOptionId: string;
}

export interface AdminOrderStoreSummary {
  id: string;
  name: string;
}

export interface AdminOrderCustomerSummary {
  id: string;
  fullName: string | null;
  phone: string;
  email: string | null;
}

export interface AdminOrderRecord {
  order: Order;
  stores: AdminOrderStoreSummary[];
  customer: AdminOrderCustomerSummary | null;
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
    private dashboardEventsService: DashboardEventsService,
    private promotionsService: PromotionsService,
    private guestOrderLinkService: GuestOrderLinkService,
    private customerRepository: CustomerRepository,
    private inventoryService: InventoryService,
    private cartService: CartService,
    @InjectRepository(Store)
    private storeRepository: Repository<Store>,
    private vendorWebhooksService: VendorWebhooksService,
    private saleCampaignPricing: SaleCampaignPricingService,
    private orderAuditLogsService: OrderAuditLogsService,
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

  /**
   * When checkout submits cartItemIds, require those lines still exist on the cart
   * and cover the same variantIds as the order items (SF-CHK-112 concurrency).
   */
  private async assertCartLinesStillPresent(
    createOrderDto: CreateOrderDto,
    customerId?: string,
  ): Promise<void> {
    const cartItemIds = createOrderDto.cartItemIds;
    if (!cartItemIds?.length) {
      return;
    }

    const cart = await this.cartService.getCart(customerId, createOrderDto.sessionId);
    const cartItems = cart.items ?? [];
    const byId = new Map(cartItems.map((item) => [item.id, item]));

    const missingIds = cartItemIds.filter((id) => !byId.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException({
        code: 'CART_ITEMS_STALE',
        message: 'One or more cart items are no longer in the cart',
      });
    }

    const cartVariantIds = new Set(
      cartItemIds.map((id) => byId.get(id)!.variantId).filter(Boolean),
    );
    const orderVariantIds = new Set(
      createOrderDto.items.map((item) => item.variantId).filter(Boolean),
    );

    for (const variantId of orderVariantIds) {
      if (!cartVariantIds.has(variantId as string)) {
        throw new BadRequestException({
          code: 'CART_ITEMS_MISMATCH',
          message: 'Order items do not match the submitted cart lines',
        });
      }
    }
    for (const variantId of cartVariantIds) {
      if (!orderVariantIds.has(variantId)) {
        throw new BadRequestException({
          code: 'CART_ITEMS_MISMATCH',
          message: 'Order items do not match the submitted cart lines',
        });
      }
    }
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

    await this.assertCartLinesStillPresent(createOrderDto, customerId);

    // Link guest checkouts to an existing member when the supplied phone already
    // belongs to an active customer, so the order shows in their history immediately
    // (instead of only after their next OTP login) and the customer-facing order
    // number stays consistent with Admin. The order keeps its guestPhone so the
    // unauthenticated buyer can still reach it via the guest payment/tracking paths.
    let linkedCustomerId: string | null = customerId ?? null;
    if (!linkedCustomerId && normalizedGuestPhone) {
      const existingCustomer =
        await this.customerRepository.findActiveByPhone(normalizedGuestPhone);
      linkedCustomerId = existingCustomer?.id ?? null;
    }

    const normalizedGuestEmail = guestEmail?.trim() || null;
    if (linkedCustomerId && normalizedGuestEmail) {
      await this.customerRepository.setEmailIfMissing(linkedCustomerId, normalizedGuestEmail);
    }

    const shippingSnapshot = await this.resolveShippingSnapshot(customerId, createOrderDto);

    const pricedLines: Array<{
      item: (typeof items)[number];
      variant: ProductVariant;
      product: Product;
      catalogUnit: number;
      unitPrice: number;
      saleCampaignId: string | null;
      saleDiscountPercent: number | null;
    }> = [];

    for (const item of items) {
      if (!item.variantId) {
        throw new BadRequestException({
          code: 'VARIANT_REQUIRED',
          message: 'A variantId is required for each order item',
        });
      }
      const variant = await this.variantRepository.findOne({
        where: { id: item.variantId },
        relations: ['product', 'product.store'],
      });
      if (!variant?.product || variant.retiredAt) {
        throw new BadRequestException({
          code: 'VARIANT_NOT_FOUND',
          message: `Variant ${item.variantId} not found`,
        });
      }
      if (variant.product.store?.status === StoreStatus.SUSPENDED) {
        throw new BadRequestException({
          code: 'ORDER_CONTAINS_SUSPENDED_STORE',
          message: 'Order contains items from a suspended store',
        });
      }
      const catalogUnit = roundMoney(
        Number(variant.product.basePrice) + Number(variant.priceAdjustment ?? 0),
      );
      pricedLines.push({
        item,
        variant,
        product: variant.product,
        catalogUnit,
        unitPrice: catalogUnit,
        saleCampaignId: null,
        saleDiscountPercent: null,
      });
    }

    const resolvedPrices = await this.saleCampaignPricing.resolveEffectiveUnitPrices(
      pricedLines.map((line) => ({
        productId: line.product.id,
        variantId: line.variant.id,
        catalogUnit: line.catalogUnit,
      })),
    );

    for (const line of pricedLines) {
      const resolved = resolvedPrices.get(line.variant.id);
      if (!resolved) continue;
      line.catalogUnit = resolved.catalogUnitPrice;
      line.unitPrice = resolved.unitPrice;
      line.saleCampaignId = resolved.saleCampaignId;
      line.saleDiscountPercent = resolved.saleDiscountPercent;
    }

    const subtotal = pricedLines.reduce(
      (sum, line) => sum + line.unitPrice * line.item.quantity,
      0,
    );
    const storeSubtotals = new Map<string, number>();
    const promotionLines: PromotionCartLine[] = [];

    for (const line of pricedLines) {
      const storeId = line.product.storeId;
      storeSubtotals.set(
        storeId,
        (storeSubtotals.get(storeId) ?? 0) + line.unitPrice * line.item.quantity,
      );
      promotionLines.push({
        productId: line.product.id,
        variantId: line.variant.id,
        quantity: line.item.quantity,
        unitPrice: line.unitPrice,
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
      const storeShippingFees = new Map(
        shippingRecords.map((record) => [record.storeId as string, Number(record.shippingFee)]),
      );
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
        { mode: 'apply', lines: promotionLines, shippingFee, storeShippingFees },
      );
      discountAmount = stacked.discountAmount;
      appliedPromotions = stacked.promotions;
      discountsByPromotionId = stacked.discountsByPromotionId;
    }

    const total = subtotal + shippingFee - discountAmount;

    // Guest checkout (no JWT): issue pay token once. Authenticated create skips this.
    const guestPayTokenIssue = !customerId && normalizedGuestPhone ? issueGuestPayToken() : null;

    const orderId = await this.dataSource.transaction(async (manager) => {
      const order = manager.create(Order, {
        orderNumber: this.generateOrderNumber(),
        customerId: linkedCustomerId,
        guestPhone: normalizedGuestPhone ?? null,
        guestName: guestName ?? null,
        guestEmail: normalizedGuestEmail,
        guestPayTokenHash: guestPayTokenIssue?.hash ?? null,
        guestPayTokenExpiresAt: guestPayTokenIssue?.expiresAt ?? null,
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
      for (const line of pricedLines) {
        const variant = await manager.findOne(ProductVariant, {
          where: { id: line.variant.id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!variant || variant.retiredAt) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_FOUND',
            message: `Variant ${line.variant.id} not found`,
          });
        }

        const product =
          variant.product ??
          (await manager.findOne(Product, {
            where: { id: variant.productId },
          }));

        if (!product) {
          throw new BadRequestException({
            code: 'VARIANT_NOT_FOUND',
            message: `Variant ${line.variant.id} not found`,
          });
        }

        // Re-read catalog under the same lock so a vendor price change mid-checkout
        // cannot persist a stale unitPrice (SF-CHK-114).
        const liveCatalog = roundMoney(
          Number(product.basePrice) + Number(variant.priceAdjustment ?? 0),
        );
        const liveResolved = await this.saleCampaignPricing.resolveEffectiveUnitPrices([
          {
            productId: product.id,
            variantId: variant.id,
            catalogUnit: liveCatalog,
          },
        ]);
        const livePrice = liveResolved.get(variant.id);
        const liveUnit = livePrice?.unitPrice ?? liveCatalog;
        if (
          Math.abs(liveCatalog - line.catalogUnit) > 0.009 ||
          Math.abs(liveUnit - line.unitPrice) > 0.009
        ) {
          throw new BadRequestException({
            code: 'PRICE_CHANGED',
            message: 'Product price changed since checkout started',
          });
        }

        const newStock = variant.stockQuantity - line.item.quantity;
        if (newStock < 0) {
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for variant ${line.variant.id}`,
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
            quantityChange: -line.item.quantity,
            quantityAfter: newStock,
            referenceId: savedOrder.id,
            referenceType: 'order',
          }),
        );

        orderItems.push(
          manager.create(OrderItem, {
            orderId: savedOrder.id,
            storeId: product.storeId,
            variantId: variant.id,
            productName: product.name,
            variantOptions: variant.options ?? {},
            unitPrice: line.unitPrice,
            catalogUnitPrice: line.catalogUnit,
            saleCampaignId: line.saleCampaignId,
            saleDiscountPercent: line.saleDiscountPercent,
            quantity: line.item.quantity,
            subtotal: line.unitPrice * line.item.quantity,
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

      await this.orderAuditLogsService.append(manager, {
        orderId: savedOrder.id,
        eventType: OrderAuditEventType.ORDER_PLACED,
        actorType: OrderAuditActorType.customer,
        actorId: linkedCustomerId,
        actorLabel: await this.orderAuditLogsService.resolveCustomerActorLabel(manager, {
          customerId: linkedCustomerId,
          guestName: guestName ?? null,
        }),
        details: { paymentMethod: savedOrder.paymentMethod },
      });

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
      this.vendorWebhooksService.dispatchOrderEvent(savedOrder.id, 'order.create').catch(() => {});
      this.publishOrderActivity(savedOrder).catch(() => {});

      return savedOrder.id;
    });

    if (createOrderDto.cartItemIds?.length) {
      await this.cartService.removeItems(
        createOrderDto.cartItemIds,
        customerId,
        createOrderDto.sessionId,
      );
    }

    const created = await this.findOne(orderId);
    if (guestPayTokenIssue) {
      created.guestPayToken = guestPayTokenIssue.plaintext;
    }
    return created;
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

  /**
   * Paginated store-scoped orders for Vendor REST (webhook catch-up / polling).
   * Ordered by updatedAt DESC then createdAt DESC.
   */
  async findAllForPublicApi(
    storeId: string,
    query: {
      page?: number;
      limit?: number;
      status?: OrderStatus;
      fulfillmentStatus?: FulfillmentStatus;
      updatedSince?: Date | string;
      createdSince?: Date | string;
      createdUntil?: Date | string;
    } = {},
  ): Promise<PaginatedResponse<Order>> {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;

    const applyFilters = (qb: ReturnType<Repository<Order>['createQueryBuilder']>) => {
      qb.innerJoin('order.items', 'filterItem', 'filterItem.storeId = :storeId', { storeId });

      if (query.status) {
        qb.andWhere('order.status = :status', { status: query.status });
      }
      if (query.fulfillmentStatus) {
        qb.andWhere('filterItem.fulfillmentStatus = :fulfillmentStatus', {
          fulfillmentStatus: query.fulfillmentStatus,
        });
      }
      if (query.updatedSince) {
        qb.andWhere('order.updatedAt >= :updatedSince', {
          updatedSince: new Date(query.updatedSince),
        });
      }
      if (query.createdSince) {
        qb.andWhere('order.createdAt >= :createdSince', {
          createdSince: new Date(query.createdSince),
        });
      }
      if (query.createdUntil) {
        qb.andWhere('order.createdAt <= :createdUntil', {
          createdUntil: new Date(query.createdUntil),
        });
      }
      return qb;
    };

    const countRow = await applyFilters(this.orderRepository.createQueryBuilder('order'))
      .select('COUNT(DISTINCT order.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(countRow?.cnt ?? 0);

    if (total === 0) {
      return {
        items: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
      };
    }

    const idRows = await applyFilters(this.orderRepository.createQueryBuilder('order'))
      .select('order.id', 'id')
      .addSelect('order.updatedAt', 'updatedAt')
      .addSelect('order.createdAt', 'createdAt')
      .groupBy('order.id')
      .addGroupBy('order.updatedAt')
      .addGroupBy('order.createdAt')
      .orderBy('order.updatedAt', 'DESC')
      .addOrderBy('order.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ id: string }>();

    const ids = idRows.map((row) => row.id);
    if (ids.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    }

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.productVariant', 'productVariant')
      .leftJoinAndSelect('order.shippingAddress', 'shippingAddress')
      .leftJoinAndSelect('order.customer', 'customer')
      .where('order.id IN (:...ids)', { ids })
      .getMany();

    const byId = new Map(orders.map((order) => [order.id, order]));
    const items = ids.map((id) => byId.get(id)).filter((order): order is Order => Boolean(order));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private collectStoreIds(orders: Order[]): string[] {
    const ids = new Set<string>();
    for (const order of orders) {
      for (const item of order.items ?? []) {
        if (item.storeId) {
          ids.add(item.storeId);
        }
      }
    }
    return [...ids];
  }

  private async loadStoreNameMap(storeIds: string[]): Promise<Map<string, string>> {
    if (storeIds.length === 0) {
      return new Map();
    }

    const stores = await this.storeRepository.find({
      where: { id: In(storeIds) },
      select: ['id', 'name'],
    });

    return new Map(stores.map((store) => [store.id, store.name]));
  }

  private mapCustomerSummary(
    customer: Customer | null | undefined,
  ): AdminOrderCustomerSummary | null {
    if (!customer) {
      return null;
    }

    return {
      id: customer.id,
      fullName: customer.fullName ?? null,
      phone: customer.phone,
      email: customer.email ?? null,
    };
  }

  private toAdminOrderRecord(order: Order, storeNames: Map<string, string>): AdminOrderRecord {
    const seen = new Set<string>();
    const stores: AdminOrderStoreSummary[] = [];

    for (const item of order.items ?? []) {
      if (!item.storeId || seen.has(item.storeId)) {
        continue;
      }
      seen.add(item.storeId);
      stores.push({
        id: item.storeId,
        name: storeNames.get(item.storeId) ?? '',
      });
    }

    return {
      order,
      stores,
      customer: this.mapCustomerSummary(order.customer),
    };
  }

  async findForAdmin(
    options: {
      page?: number;
      limit?: number;
      search?: string;
      status?: OrderStatus;
    } = {},
  ): Promise<PaginatedResponse<AdminOrderRecord>> {
    const page = normalizeCustomerOrdersPage(options.page);
    const limit = normalizeCustomerOrdersLimit(options.limit);
    const offset = (page - 1) * limit;
    const search = options.search?.trim();

    const applyFilters = (qb: ReturnType<Repository<Order>['createQueryBuilder']>) => {
      if (search) {
        qb.andWhere('order.orderNumber ILIKE :search', { search: `%${search}%` });
      }
      if (options.status) {
        qb.andWhere('order.status = :status', { status: options.status });
      }
      return qb;
    };

    const countRow = await applyFilters(this.orderRepository.createQueryBuilder('order'))
      .select('COUNT(DISTINCT order.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(countRow?.cnt ?? 0);

    if (total === 0) {
      return {
        items: [],
        pagination: { page, limit, total: 0, totalPages: 1 },
      };
    }

    const idRows = await applyFilters(this.orderRepository.createQueryBuilder('order'))
      .select('order.id', 'id')
      .addSelect('order.createdAt', 'createdAt')
      .groupBy('order.id')
      .addGroupBy('order.createdAt')
      .orderBy('order.createdAt', 'DESC')
      .offset(offset)
      .limit(limit)
      .getRawMany<{ id: string }>();

    const ids = idRows.map((row) => row.id);
    if (ids.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    }

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.productVariant', 'productVariant')
      .leftJoinAndSelect('productVariant.product', 'product')
      .leftJoinAndSelect('product.images', 'productImages')
      .leftJoinAndSelect('order.shippingAddress', 'shippingAddress')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('order.storeShippings', 'storeShippings')
      .where('order.id IN (:...ids)', { ids })
      .withDeleted()
      .getMany();

    const byId = new Map(orders.map((order) => [order.id, order]));
    const ordered = ids.map((id) => byId.get(id)).filter((order): order is Order => Boolean(order));
    const storeNames = await this.loadStoreNameMap(this.collectStoreIds(ordered));

    return {
      items: ordered.map((order) => this.toAdminOrderRecord(order, storeNames)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOneForAdmin(id: string): Promise<AdminOrderRecord> {
    const order = await this.findOne(id);
    const storeNames = await this.loadStoreNameMap(this.collectStoreIds([order]));
    return this.toAdminOrderRecord(order, storeNames);
  }

  async findPendingBankTransferOrders(options?: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Order>> {
    const page = normalizeCustomerOrdersPage(options?.page);
    const limit = normalizeCustomerOrdersLimit(options?.limit);

    const [items, total] = await this.orderRepository.findAndCount({
      where: {
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        status: OrderStatus.PENDING_PAYMENT,
      },
      relations: ['items', 'shippingAddress', 'customer', 'storeShippings'],
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async updateShippingAddressAsAdmin(
    orderId: string,
    input: {
      fullName: string;
      phone: string;
      addressLine1: string;
      addressLine2?: string | null;
      tumbon?: string | null;
      amphoe: string;
      province: string;
      postalCode: string;
    },
  ): Promise<Order> {
    const order = await this.findOne(orderId);
    if (!order.shippingAddress) {
      throw new NotFoundException({
        code: 'SHIPPING_ADDRESS_NOT_FOUND',
        message: 'Order shipping address not found',
      });
    }

    const address = order.shippingAddress;
    address.fullName = input.fullName.trim();
    address.phone = normalizeThaiPhoneToLocal(input.phone);
    address.addressLine1 = input.addressLine1.trim();
    address.addressLine2 = input.addressLine2?.trim() || null;
    address.tumbon = input.tumbon?.trim() || null;
    address.amphoe = input.amphoe.trim();
    address.province = input.province.trim();
    address.postalCode = input.postalCode.trim();

    await this.dataSource.getRepository(OrderShippingAddress).save(address);
    return this.findOne(orderId);
  }

  async updateStatus(id: string, status: OrderStatus, userId?: string): Promise<Order> {
    const order = await this.findOne(id);
    const previousStatus = order.status;

    if (
      order.paymentMethod === PaymentMethod.BANK_TRANSFER &&
      previousStatus === OrderStatus.PENDING_PAYMENT &&
      status === OrderStatus.PAID
    ) {
      throw new BadRequestException({
        code: 'USE_CONFIRM_BANK_TRANSFER',
        message: 'Use confirmBankTransferPaid to approve bank transfer payments',
      });
    }

    assertNotManualHoldTransition(previousStatus, status);

    const isAdminHoldExit =
      (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) &&
      (previousStatus === OrderStatus.ON_HOLD ||
        order.items.some((item) => item.fulfillmentStatus === FulfillmentStatus.ON_HOLD));

    order.status = status;

    await this.dataSource.transaction(async (manager) => {
      if (status === OrderStatus.PAID) {
        order.paidAt = new Date();
      }

      if (isAdminHoldExit) {
        const now = new Date();
        for (const item of order.items) {
          if (item.fulfillmentStatus === FulfillmentStatus.ON_HOLD) {
            item.fulfillmentStatus = FulfillmentStatus.CANCELLED;
            item.previousFulfillmentStatus = null;
            item.holdStartedAt = null;
            item.updatedAt = now;
          } else if (status === OrderStatus.CANCELLED || status === OrderStatus.REFUNDED) {
            item.fulfillmentStatus = FulfillmentStatus.CANCELLED;
            item.updatedAt = now;
          }
        }
        order.previousStatus = null;
        await manager.save(OrderItem, order.items);
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
    this.publishOrderActivity(saved).catch(() => {});
    if (previousStatus !== status) {
      const webhookEvent = webhookEventForOrderStatus(status);
      if (webhookEvent) {
        this.vendorWebhooksService.dispatchOrderEvent(saved.id, webhookEvent).catch(() => {});
      }
    }

    return saved;
  }

  private async publishOrderActivity(order: Order): Promise<void> {
    const storeIds = [...new Set((order.items ?? []).map((item) => item.storeId).filter(Boolean))];
    let ownerIds: string[] = [];
    if (storeIds.length > 0) {
      const stores = await this.storeRepository.find({
        where: { id: In(storeIds) },
        select: ['ownerId'],
      });
      ownerIds = stores.map((store) => store.ownerId).filter(Boolean);
    }

    await this.dashboardEventsService.publish({
      kind: DashboardActivityKind.ORDER,
      entityId: order.id,
      storeId: storeIds[0] ?? null,
      userIds: ownerIds,
      roles: ['admin'],
    });
  }
}
