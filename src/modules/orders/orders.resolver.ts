import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { PaymentsService } from '../payments/payments.service';
import { ProductsService } from '../products/products.service';
import { StoresService } from '../stores/stores.service';
import {
  AdminOrder,
  AdminOrderConnection,
  OrderTrackingType,
  OrderType,
  ProductType,
  OrderConnection,
} from '../../graphql/models/types';
import { mapProduct } from '../../graphql/models/mappers';
import { mapOrder, mapOrderTracking } from './order.mapper';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ConfirmOrderDeliveredInput,
  CreateOrderInput,
  ShipVendorOrderInput,
  UpdateOrderShippingAddressAsAdminInput,
  UpdateOrderStatusInput,
} from './orders.inputs';
import { OrderStatus } from '../../database/entities/order.entity';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';
import { CustomerOrderListFilter } from './order-list-filter.util';
import type { AdminOrderRecord } from './orders.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { getAuditRequestContext } from '../audit-logs/audit-request-context';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

function mapAdminOrder(record: AdminOrderRecord): AdminOrder {
  const order = mapOrder(record.order);
  order.guestPayToken = null;
  return {
    order,
    stores: record.stores,
    customer: record.customer,
  };
}

@Resolver()
export class OrdersResolver {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly auditLogsService: AuditLogsService,
    private readonly orderFulfillmentService: OrderFulfillmentService,
    private readonly paymentsService: PaymentsService,
    private readonly productsService: ProductsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => ProductType, { nullable: true })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async latestPurchaseProduct(@CurrentUser('id') customerId: string): Promise<ProductType | null> {
    const productId = await this.ordersService.findLatestPurchaseProductId(customerId);
    if (!productId) {
      return null;
    }

    try {
      const product = await this.productsService.findOnePublished(productId);
      return mapProduct(product);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }

  @Query(() => [ProductType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async latestPurchaseProducts(
    @CurrentUser('id') customerId: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 10 }) limit?: number,
  ): Promise<ProductType[]> {
    const cappedLimit = Math.min(Math.max(limit ?? 10, 1), 20);
    const productIds = await this.ordersService.findLatestPurchaseProductIds(
      customerId,
      cappedLimit,
    );
    const products = await this.productsService.findPublishedByIds(productIds);
    return products.map(mapProduct);
  }

  @Query(() => OrderConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async orders(
    @CurrentUser('id') customerId: string,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 10 }) limit?: number,
    @Args('filter', {
      type: () => CustomerOrderListFilter,
      nullable: true,
      defaultValue: CustomerOrderListFilter.ALL,
    })
    filter?: CustomerOrderListFilter,
  ): Promise<OrderConnection> {
    const result = await this.ordersService.findByCustomerPaginated(customerId, {
      page,
      limit,
      filter,
    });
    return {
      items: result.items.map((order) => mapOrder(order)),
      pagination: result.pagination,
    };
  }

  @Query(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async order(@Args('id') id: string, @CurrentUser('id') customerId: string): Promise<OrderType> {
    const order = await this.ordersService.findOne(id);
    if (order.customerId !== customerId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this order',
      });
    }
    return mapOrder(order);
  }

  @Query(() => OrderTrackingType)
  @Public()
  async orderTracking(@Args('orderNumber') orderNumber: string): Promise<OrderTrackingType> {
    const order = await this.ordersService.findByOrderNumber(orderNumber.trim());
    return mapOrderTracking(order);
  }

  @Query(() => [OrderType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorOrders(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<OrderType[]> {
    await this.storesService.assertStoreAccess(userId, storeId);

    const orders = await this.ordersService.findByStore(storeId);
    return orders.map((order) => mapOrder(order, storeId));
  }

  @Query(() => AdminOrderConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminOrders(
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('status', { type: () => String, nullable: true }) status?: string,
  ): Promise<AdminOrderConnection> {
    let parsedStatus: OrderStatus | undefined;
    if (status) {
      const allowed = Object.values(OrderStatus) as string[];
      if (!allowed.includes(status)) {
        throw new BadRequestException({
          code: 'INVALID_ORDER_STATUS',
          message: 'Invalid order status filter',
        });
      }
      parsedStatus = status as OrderStatus;
    }

    const result = await this.ordersService.findForAdmin({
      page,
      limit,
      search,
      status: parsedStatus,
    });
    return {
      items: result.items.map(mapAdminOrder),
      pagination: result.pagination,
    };
  }

  @Query(() => AdminOrder)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminOrder(@Args('id') id: string): Promise<AdminOrder> {
    const record = await this.ordersService.findOneForAdmin(id);
    return mapAdminOrder(record);
  }

  @Query(() => OrderConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingBankTransferOrders(
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<OrderConnection> {
    const result = await this.ordersService.findPendingBankTransferOrders({ page, limit });
    return {
      items: result.items.map((order) => mapOrder(order)),
      pagination: result.pagination,
    };
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async confirmBankTransferPaid(
    @Args('orderId') orderId: string,
    @CurrentUser('id') userId: string,
    @Args('note', { type: () => String, nullable: true }) note?: string,
  ): Promise<OrderType> {
    const updated = await this.paymentsService.confirmBankTransferPaid(orderId, userId, note);
    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @Public()
  async createOrder(
    @Args('input') input: CreateOrderInput,
    @CurrentUser('id') customerId?: string,
    @CurrentUser('role') role?: string,
  ): Promise<OrderType> {
    const effectiveCustomerId = role === 'customer' ? customerId : undefined;

    const order = await this.ordersService.create(
      {
        items: input.items,
        savedAddressId: input.savedAddressId,
        shippingAddress: input.shippingAddress
          ? {
              recipientName: input.shippingAddress.recipientName,
              recipientPhone: input.shippingAddress.recipientPhone,
              addressLine1: input.shippingAddress.addressLine1,
              addressLine2: input.shippingAddress.addressLine2,
              tumbon: input.shippingAddress.tumbon,
              amphoe: input.shippingAddress.amphoe ?? input.shippingAddress.city ?? '',
              province: input.shippingAddress.province,
              postalCode: input.shippingAddress.postalCode,
            }
          : undefined,
        promotionCode: input.promotionCode,
        platformPromotionCode: input.platformPromotionCode,
        storePromotionCodes: input.storePromotionCodes,
        storeShipping: input.storeShipping,
        guestPhone: input.guestPhone,
        guestName: input.guestName,
        guestEmail: input.guestEmail,
        notes: input.notes,
        paymentMethod: normalizeCheckoutPaymentMethod(input.paymentMethod),
        cartItemIds: input.cartItemIds,
        sessionId: input.sessionId,
      },
      effectiveCustomerId,
    );

    return mapOrder(order);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateOrderStatus(
    @Args('input') input: UpdateOrderStatusInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<OrderType> {
    const order = await this.ordersService.findOne(input.orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const previousStatus = order.status;
    const updated = await this.ordersService.updateStatus(
      input.orderId,
      input.status as OrderStatus,
      userId,
    );

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: userId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.ORDER_STATUS_UPDATED,
      resourceType: AuditResourceType.ORDER,
      resourceId: updated.id,
      metadata: { previousStatus, status: input.status },
      ...getAuditRequestContext(context?.req),
    });

    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateOrderShippingAddressAsAdmin(
    @Args('input') input: UpdateOrderShippingAddressAsAdminInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
    @Context() context?: GraphqlContext,
  ): Promise<OrderType> {
    const updated = await this.ordersService.updateShippingAddressAsAdmin(input.orderId, {
      fullName: input.fullName,
      phone: input.phone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      tumbon: input.tumbon,
      amphoe: input.amphoe,
      province: input.province,
      postalCode: input.postalCode,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.ORDER_SHIPPING_UPDATED,
      resourceType: AuditResourceType.ORDER,
      resourceId: updated.id,
      metadata: { operation: 'shipping_address_update' },
      ...getAuditRequestContext(context?.req),
    });

    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async markVendorOrderPaid(
    @Args('orderId') orderId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const updated = await this.orderFulfillmentService.markVendorOrderPaid(
      userId,
      storeId,
      orderId,
    );
    return mapOrder(updated, storeId);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async acknowledgeVendorOrder(
    @Args('orderId') orderId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const updated = await this.orderFulfillmentService.acknowledgeVendorOrder(
      userId,
      storeId,
      orderId,
    );
    return mapOrder(updated, storeId);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async shipVendorOrder(
    @Args('input') input: ShipVendorOrderInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const updated = await this.orderFulfillmentService.shipVendorOrder(
      userId,
      storeId,
      input.orderId,
      input.trackingNumber,
      input.fulfillmentProvider,
      input.trackingUrl,
    );
    return mapOrder(updated, storeId);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async confirmOrderDelivered(
    @Args('input') input: ConfirmOrderDeliveredInput,
    @CurrentUser('id') customerId: string,
  ): Promise<OrderType> {
    const updated = await this.orderFulfillmentService.confirmOrderDelivered(
      input.orderId,
      customerId,
    );
    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @Public()
  async confirmGuestOrderDelivered(
    @Args('input') input: ConfirmOrderDeliveredInput,
  ): Promise<OrderType> {
    if (!input.guestPhone) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Guest phone is required to confirm delivery',
      });
    }
    const updated = await this.orderFulfillmentService.confirmOrderDelivered(
      input.orderId,
      undefined,
      input.guestPhone,
      input.guestPayToken,
    );
    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async cancelVendorOrder(
    @Args('orderId') orderId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreAccess(userId, storeId);
    const updated = await this.orderFulfillmentService.cancelVendorOrder(userId, storeId, orderId);
    return mapOrder(updated, storeId);
  }
}
