import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderFulfillmentService } from './order-fulfillment.service';
import { ProductsService } from '../products/products.service';
import { StoresService } from '../stores/stores.service';
import { OrderType, ProductType, OrderConnection } from '../../graphql/models/types';
import { mapProduct } from '../../graphql/models/mappers';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ConfirmOrderDeliveredInput,
  CreateOrderInput,
  ShipVendorOrderInput,
  UpdateOrderStatusInput,
} from './orders.inputs';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { normalizeCheckoutPaymentMethod } from '../../common/utils/checkout-payment.util';
import { CustomerOrderListFilter } from './order-list-filter.util';

function mapOrder(order: Order): OrderType {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    subtotal: Number(order.subtotal),
    shippingFee: Number(order.shippingFee),
    discountAmount: Number(order.discountAmount),
    total: Number(order.total),
    paymentMethod: order.paymentMethod,
    guestPhone: order.guestPhone ?? null,
    guestName: order.guestName ?? null,
    guestEmail: order.guestEmail ?? null,
    createdAt: order.createdAt,
    storeShippings:
      order.storeShippings?.map((shipping) => ({
        storeId: shipping.storeId,
        optionName: shipping.optionName,
        shippingFee: Number(shipping.shippingFee),
      })) ?? [],
    items:
      order.items?.map((item) => ({
        id: item.id,
        storeId: item.storeId,
        variantId: item.variantId,
        productName: item.productName,
        unitPrice: Number(item.unitPrice),
        quantity: item.quantity,
        subtotal: Number(item.subtotal),
        fulfillmentStatus: item.fulfillmentStatus,
        trackingNumber: item.trackingNumber ?? null,
        fulfillmentProvider: item.fulfillmentProvider ?? null,
        trackingUrl: item.trackingUrl ?? null,
      })) ?? [],
    shippingAddress: order.shippingAddress
      ? {
          fullName: order.shippingAddress.fullName,
          phone: order.shippingAddress.phone,
          addressLine1: order.shippingAddress.addressLine1,
          addressLine2: order.shippingAddress.addressLine2,
          tumbon: order.shippingAddress.tumbon,
          amphoe: order.shippingAddress.amphoe,
          province: order.shippingAddress.province,
          postalCode: order.shippingAddress.postalCode,
        }
      : null,
  };
}

@Resolver()
export class OrdersResolver {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderFulfillmentService: OrderFulfillmentService,
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
      items: result.items.map(mapOrder),
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

  @Query(() => [OrderType])
  @Public()
  async guestOrders(@Args('guestPhone') guestPhone: string): Promise<OrderType[]> {
    const orders = await this.ordersService.findByGuestPhone(guestPhone);
    return orders.map(mapOrder);
  }

  @Query(() => [OrderType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorOrders(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType[]> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const orders = await this.ordersService.findByStore(storeId);
    return orders.map(mapOrder);
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
  ): Promise<OrderType> {
    const order = await this.ordersService.findOne(input.orderId);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const updated = await this.ordersService.updateStatus(
      input.orderId,
      input.status as OrderStatus,
      userId,
    );
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
    await this.storesService.assertStoreOwner(userId, storeId);
    const updated = await this.orderFulfillmentService.markVendorOrderPaid(
      userId,
      storeId,
      orderId,
    );
    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async acknowledgeVendorOrder(
    @Args('orderId') orderId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const updated = await this.orderFulfillmentService.acknowledgeVendorOrder(
      userId,
      storeId,
      orderId,
    );
    return mapOrder(updated);
  }

  @Mutation(() => OrderType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async shipVendorOrder(
    @Args('input') input: ShipVendorOrderInput,
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<OrderType> {
    await this.storesService.assertStoreOwner(userId, storeId);
    const updated = await this.orderFulfillmentService.shipVendorOrder(
      userId,
      storeId,
      input.orderId,
      input.trackingNumber,
      input.fulfillmentProvider,
      input.trackingUrl,
    );
    return mapOrder(updated);
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
    await this.storesService.assertStoreOwner(userId, storeId);
    const updated = await this.orderFulfillmentService.cancelVendorOrder(userId, storeId, orderId);
    return mapOrder(updated);
  }
}
