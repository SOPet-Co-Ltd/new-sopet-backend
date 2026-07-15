// Public Order Tracking (e2e) — promoted from test/order-tracking.int.test.ts
// Design Doc: order-tracking-backend.md | Green phase: order-tracking-backend-task-08
//
// Harness: Nest TestingModule + GraphQLModule (ApolloDriver) + supertest POST /graphql
// @real-dependency: mapOrderTracking + OrdersService.findByOrderNumber on hot path
// @mock-boundary: orderRepository (seeded row) — mirrors project e2e harness conventions

import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { unwrapResolverError } from '@apollo/server/errors';
import type { GraphQLFormattedError } from 'graphql';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { OrdersResolver } from '../src/modules/orders/orders.resolver';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrderFulfillmentService } from '../src/modules/orders/order-fulfillment.service';
import { ProductsService } from '../src/modules/products/products.service';
import { StoresService } from '../src/modules/stores/stores.service';
import { Order, OrderStatus, PaymentMethod } from '../src/database/entities/order.entity';
import { FulfillmentStatus } from '../src/database/entities/order-item.entity';
import { OrderItem } from '../src/database/entities/order-item.entity';
import { OrderStoreShipping } from '../src/database/entities/order-store-shipping.entity';
import { SavedAddress } from '../src/database/entities/saved-address.entity';
import { ProductVariant } from '../src/database/entities/product-variant.entity';
import { Product } from '../src/database/entities/product.entity';
import { StoreShippingOption } from '../src/database/entities/store-shipping-option.entity';
import { Store } from '../src/database/entities/store.entity';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PromotionsService } from '../src/modules/promotions/promotions.service';
import { GuestOrderLinkService } from '../src/modules/orders/guest-order-link.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { CartService } from '../src/modules/cart/cart.service';
import { resolveOrderItemImageUrl } from '../src/modules/orders/order.mapper';
import {
  mapException,
  mapUnknownException,
  responseFromHttpException,
} from '../src/common/utils/exception-response.util';

const ORDER_TRACKING_QUERY = `
  query OrderTracking($orderNumber: String!) {
    orderTracking(orderNumber: $orderNumber) {
      orderNumber
      status
      createdAt
      subtotal
      shippingFee
      discountAmount
      total
      items {
        productName
        quantity
        unitPrice
        subtotal
        productImageUrl
        trackingNumber
        fulfillmentProvider
        trackingUrl
        fulfillmentStatus
      }
      storeShippings {
        optionName
        shippingFee
      }
    }
  }
`;

const SEED_ORDER_NUMBER = 'ORD-TRACK-E2E-001';
const SEED_CREATED_AT = new Date('2024-06-15T10:30:00.000Z');
const PRODUCT_IMAGE_URL = 'https://cdn.example.com/dog-food-thumb.jpg';
const ORDER_NOT_FOUND_MESSAGE = 'Order not found';

interface GraphQLErrorExtension {
  code: string;
}

interface GraphQLErrorBody {
  message: string;
  extensions: GraphQLErrorExtension;
}

interface OrderTrackingItemResponse {
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  productImageUrl: string | null;
  trackingNumber: string;
  fulfillmentProvider: string;
  trackingUrl: string;
  fulfillmentStatus: FulfillmentStatus;
}

interface OrderTrackingResponse {
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  items: OrderTrackingItemResponse[];
  storeShippings: Array<{ optionName: string; shippingFee: number }>;
}

interface OrderTrackingSuccessBody {
  data: { orderTracking: OrderTrackingResponse };
}

interface OrderTrackingErrorBody {
  data: { orderTracking: null } | null;
  errors: GraphQLErrorBody[];
}

const PII_KEYS = [
  'id',
  'customerId',
  'guestPhone',
  'guestName',
  'guestEmail',
  'shippingAddress',
  'paymentMethod',
  'paymentReference',
  'notes',
  'paidAt',
] as const;

function buildSeededOrder(): Order {
  const createdAt = SEED_CREATED_AT;

  const item = {
    id: 'item-track-e2e-1',
    orderId: 'order-track-e2e-1',
    storeId: 'store-1',
    variantId: 'variant-1',
    productName: 'Dog Food',
    variantOptions: {},
    unitPrice: 250,
    quantity: 2,
    subtotal: 500,
    fulfillmentStatus: FulfillmentStatus.SHIPPED,
    trackingNumber: 'TH123456789',
    fulfillmentProvider: 'kerry',
    trackingUrl: 'https://track.example.com/TH123456789',
    shippedAt: createdAt,
    deliveredAt: null,
    createdAt,
    updatedAt: createdAt,
    productVariant: {
      productId: 'prod-1',
      imageUrl: null,
      product: {
        images: [{ url: PRODUCT_IMAGE_URL, isThumbnail: true }],
      },
    },
  } as OrderItem;

  return {
    id: 'order-track-e2e-1',
    orderNumber: SEED_ORDER_NUMBER,
    customerId: 'cust-secret',
    guestPhone: '+66812345678',
    guestName: 'Secret Guest',
    guestEmail: 'secret@example.com',
    status: OrderStatus.PAID,
    subtotal: 500,
    discountAmount: 0,
    shippingFee: 80,
    total: 580,
    paymentMethod: PaymentMethod.PROMPTPAY,
    paymentReference: 'PAY-REF-SECRET',
    paidAt: new Date('2024-06-15T11:00:00.000Z'),
    notes: 'Secret notes',
    createdAt,
    updatedAt: createdAt,
    items: [item],
    storeShippings: [
      {
        id: 'oss-track-e2e-1',
        orderId: 'order-track-e2e-1',
        storeId: 'store-1',
        shippingOptionId: 'ship-opt-1',
        optionName: 'Standard Delivery',
        shippingFee: 50,
        createdAt,
      },
      {
        id: 'oss-track-e2e-2',
        orderId: 'order-track-e2e-1',
        storeId: 'store-2',
        shippingOptionId: 'ship-opt-2',
        optionName: 'Express',
        shippingFee: 30,
        createdAt,
      },
    ] as OrderStoreShipping[],
    shippingAddress: {
      id: 'addr-track-e2e-1',
      orderId: 'order-track-e2e-1',
      savedAddressId: null,
      fullName: 'Secret Recipient',
      phone: '+66898765432',
      addressLine1: '99 Hidden Lane',
      addressLine2: null,
      tumbon: null,
      amphoe: 'Bang Kapi',
      province: 'Bangkok',
      postalCode: '10240',
      createdAt,
    },
  } as Order;
}

function graphqlFormatError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const originalError = unwrapResolverError(error);

  if (originalError instanceof HttpException) {
    const mapped = responseFromHttpException(originalError);
    return {
      ...formattedError,
      message: mapped.message,
      extensions: {
        ...formattedError.extensions,
        code: mapped.code,
        ...(mapped.details ? { details: mapped.details } : {}),
      },
    };
  }

  const mapped = mapUnknownException(originalError) ?? mapException(originalError);

  return {
    ...formattedError,
    message: mapped.message,
    extensions: {
      ...formattedError.extensions,
      code: mapped.code,
      ...(mapped.details ? { details: mapped.details } : {}),
    },
  };
}

describe('Order tracking (e2e)', () => {
  let app: INestApplication<App>;
  let orderRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    orderRepository = { findOne: jest.fn() };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          formatError: graphqlFormatError,
        }),
      ],
      providers: [
        OrdersResolver,
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(OrderItem), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(SavedAddress), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(ProductVariant), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Product), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(StoreShippingOption), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Store), useValue: { findOne: jest.fn() } },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: NotificationsService, useValue: { notifyOrderStatusChanged: jest.fn() } },
        { provide: PromotionsService, useValue: { applyStackedPromotions: jest.fn() } },
        { provide: GuestOrderLinkService, useValue: {} },
        { provide: InventoryService, useValue: {} },
        { provide: CartService, useValue: {} },
        { provide: OrderFulfillmentService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: StoresService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  function postOrderTracking(orderNumber: string) {
    return request(app.getHttpServer()).post('/graphql').send({
      query: ORDER_TRACKING_QUERY,
      variables: { orderNumber },
    });
  }

  describe('unauthenticated orderTracking success — allowlisted fields without PII', () => {
    it('returns OrderTrackingType with correct totals, items, storeShippings, fulfillment metadata, and no PII keys when orderNumber matches a seeded order', async () => {
      const seededOrder = buildSeededOrder();
      orderRepository.findOne.mockResolvedValue(seededOrder);

      const res = await postOrderTracking(SEED_ORDER_NUMBER).expect(200);
      const body = res.body as OrderTrackingSuccessBody;

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { orderNumber: SEED_ORDER_NUMBER },
        relations: [
          'items',
          'items.productVariant',
          'items.productVariant.product',
          'items.productVariant.product.images',
          'storeShippings',
        ],
        // Soft-deleted variants remain joinable for extras (image / productId).
        withDeleted: true,
      });

      const tracking = body.data.orderTracking;
      expect(tracking).toBeDefined();
      expect(tracking.orderNumber).toBe(SEED_ORDER_NUMBER);
      expect(tracking.status).toBe(OrderStatus.PAID);
      expect(tracking.createdAt).toBe(SEED_CREATED_AT.toISOString());
      expect(tracking.subtotal).toBe(500);
      expect(tracking.shippingFee).toBe(80);
      expect(tracking.discountAmount).toBe(0);
      expect(tracking.total).toBe(580);
      expect(tracking.items).toHaveLength(1);
      expect(tracking.items[0]).toMatchObject({
        productName: 'Dog Food',
        quantity: 2,
        unitPrice: 250,
        subtotal: 500,
        trackingNumber: 'TH123456789',
        fulfillmentProvider: 'kerry',
        trackingUrl: 'https://track.example.com/TH123456789',
        fulfillmentStatus: FulfillmentStatus.SHIPPED,
      });
      expect(tracking.items[0].productImageUrl).toBe(
        resolveOrderItemImageUrl(seededOrder.items[0]),
      );
      expect(tracking.items[0].productImageUrl).toBe(PRODUCT_IMAGE_URL);
      expect(tracking.storeShippings).toEqual([
        { optionName: 'Standard Delivery', shippingFee: 50 },
        { optionName: 'Express', shippingFee: 30 },
      ]);

      for (const key of PII_KEYS) {
        expect(tracking).not.toHaveProperty(key);
      }

      const responseJson = JSON.stringify(body);
      expect(responseJson).not.toContain('cust-secret');
      expect(responseJson).not.toContain('+66812345678');
      expect(responseJson).not.toContain('Secret Guest');
      expect(responseJson).not.toContain('secret@example.com');
      expect(responseJson).not.toContain('PAY-REF-SECRET');
      expect(responseJson).not.toContain('order-track-e2e-1');
      expect(responseJson).not.toContain('99 Hidden Lane');
      expect(responseJson).not.toContain('Secret Recipient');
    });
  });

  describe('orderTracking ORDER_NOT_FOUND — anti-enumeration', () => {
    const notFoundInputs = [
      { label: 'unknown well-formed number', orderNumber: 'ORD-NOTEXIST-XXXX' },
      { label: 'garbage string', orderNumber: '!!!garbage' },
      { label: 'whitespace-only trimmed input', orderNumber: '   ' },
    ] as const;

    it('returns identical ORDER_NOT_FOUND for unknown, garbage, and whitespace-only orderNumber inputs without Authorization', async () => {
      const errorCodes: string[] = [];
      const errorMessages: string[] = [];

      for (const { orderNumber } of notFoundInputs) {
        orderRepository.findOne.mockResolvedValue(null);

        const res = await postOrderTracking(orderNumber).expect(200);
        const body = res.body as OrderTrackingErrorBody;

        expect(body.data?.orderTracking ?? null).toBeNull();
        expect(body.errors).toHaveLength(1);
        expect(body.errors[0].extensions.code).toBe('ORDER_NOT_FOUND');
        expect(body.errors[0].message).toBe(ORDER_NOT_FOUND_MESSAGE);
        errorCodes.push(body.errors[0].extensions.code);
        errorMessages.push(body.errors[0].message);
      }

      expect(new Set(errorCodes)).toEqual(new Set(['ORDER_NOT_FOUND']));
      expect(new Set(errorMessages).size).toBe(1);
      expect(errorMessages[0]).toBe(ORDER_NOT_FOUND_MESSAGE);
    });
  });
});
