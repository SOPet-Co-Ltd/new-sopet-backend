// Public Order Tracking (e2e) — promoted from test/order-tracking.int.test.ts
// Design Doc: order-tracking-backend.md | Green phase: order-tracking-backend-task-08
//
// Harness: Nest TestingModule + GraphQLModule (ApolloDriver) + supertest POST /graphql
// @real-dependency: PostgreSQL (orders, order_items, order_store_shippings, product_variants, product_images)
// @real-dependency: OrdersResolver + OrdersService + mapOrderTracking (wired in task-08)

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import request from 'supertest';
import { App } from 'supertest/types';

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

describe('Order tracking (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
        }),
      ],
      // OrdersResolver + real PostgreSQL seed wired in order-tracking-backend-task-08
      providers: [],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  // Wired in order-tracking-backend-task-08 assertions
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function postOrderTracking(orderNumber: string) {
    return request(app.getHttpServer()).post('/graphql').send({
      query: ORDER_TRACKING_QUERY,
      variables: { orderNumber },
    });
  }

  describe('unauthenticated orderTracking success — allowlisted fields without PII', () => {
    // Skeleton block 1 (AC-008, AC-010): seed order with PII columns, images,
    // storeShippings, and fulfillment fields; POST without Authorization; assert
    // allowlist field literals, productImageUrl resolution, and response JSON
    // excludes guestPhone, guestName, guestEmail, shippingAddress, customerId,
    // paymentReference, and internal order id.

    it.todo(
      'returns OrderTrackingType with correct totals, items, storeShippings, fulfillment metadata, and no PII keys when orderNumber matches a seeded order',
    );
  });

  describe('orderTracking ORDER_NOT_FOUND — anti-enumeration', () => {
    // Skeleton block 2 (AC-009): unknown well-formed number (`ORD-NOTEXIST-XXXX`),
    // garbage string (`!!!garbage`), and whitespace-only trimmed input (`   `) all
    // return identical extensions.code ORDER_NOT_FOUND with null orderTracking data.

    it.todo(
      'returns identical ORDER_NOT_FOUND for unknown, garbage, and whitespace-only orderNumber inputs without Authorization',
    );
  });
});
