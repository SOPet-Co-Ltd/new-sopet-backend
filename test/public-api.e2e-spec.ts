import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { PublicApiController } from '../src/modules/public-api/public-api.controller';
import { ApiKeyGuard } from '../src/modules/api-keys/guards/api-key.guard';
import { ApiKeyRateLimitGuard } from '../src/modules/api-keys/guards/api-key-rate-limit.guard';
import { RedisService } from '../src/modules/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { ProductsService } from '../src/modules/products/products.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { OrderFulfillmentService } from '../src/modules/orders/order-fulfillment.service';
import { VendorWebhooksService } from '../src/modules/vendor-webhooks/vendor-webhooks.service';
import { ReviewsService } from '../src/modules/reviews/reviews.service';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ProductStatus } from '../src/database/entities/product.entity';
import { OrderStatus } from '../src/database/entities/order.entity';
import { FulfillmentStatus } from '../src/database/entities/order-item.entity';
import { ReviewSource, ReviewStatus } from '../src/database/entities/review.entity';

describe('Public API products (e2e)', () => {
  let app: INestApplication<App>;
  let apiKeysService: { verifyAndAuthenticate: jest.Mock };
  let productsService: {
    createWithVariants: jest.Mock;
    findAllForPublicApi: jest.Mock;
    findOneInStore: jest.Mock;
    updateProductForPublicApi: jest.Mock;
    updateVariantStockPriceForPublicApi: jest.Mock;
    removeForPublicApi: jest.Mock;
  };
  let ordersService: { findAllForPublicApi: jest.Mock };
  let orderFulfillmentService: { updateTrackingForPublicApi: jest.Mock };
  let vendorWebhooksService: {
    getForStore: jest.Mock;
    upsertForStore: jest.Mock;
    deleteForStore: jest.Mock;
  };
  let reviewsService: { createImportedForPublicApi: jest.Mock };

  const storeId = 'store-1';
  const validBody = {
    name: 'ทดสอบสินค้า',
    description: 'รายละเอียด',
    category: 'อาหารแมว',
    tags: ['ออร์แกนิค'],
    variants: [{ name: 'รสชาติ', values: ['ไก่', 'ปลา'] }],
    variantItems: [
      { sku: 'TEST-CHK-001', stock: 10, price: 499, options: { รสชาติ: 'ไก่' } },
      { sku: 'TEST-FISH-001', stock: 5, price: 519, options: { รสชาติ: 'ปลา' } },
    ],
  };

  const createdProduct = {
    id: 'prod-1',
    storeId,
    name: validBody.name,
    slug: 'test-product',
    description: validBody.description,
    basePrice: 499,
    status: ProductStatus.DRAFT,
    averageRating: 0,
    reviewCount: 0,
    variants: [
      {
        id: 'var-1',
        sku: 'TEST-CHK-001',
        stockQuantity: 10,
        priceAdjustment: 0,
        options: { รสชาติ: 'ไก่' },
      },
      {
        id: 'var-2',
        sku: 'TEST-FISH-001',
        stockQuantity: 5,
        priceAdjustment: 20,
        options: { รสชาติ: 'ปลา' },
      },
    ],
  };

  const updatedVariant = {
    id: 'var-1',
    sku: 'TEST-CHK-001',
    stockQuantity: 20,
    priceAdjustment: 50,
    product: { basePrice: 499, storeId },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    apiKeysService = {
      verifyAndAuthenticate: jest.fn().mockResolvedValue({
        id: 'key-1',
        storeId,
        createdBy: 'user-1',
      }),
    };
    productsService = {
      createWithVariants: jest.fn().mockResolvedValue(createdProduct),
      findAllForPublicApi: jest.fn().mockResolvedValue({
        items: [createdProduct],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
      findOneInStore: jest.fn().mockResolvedValue(createdProduct),
      updateProductForPublicApi: jest.fn().mockResolvedValue({
        ...createdProduct,
        name: 'Updated name',
        description: 'Updated desc',
      }),
      updateVariantStockPriceForPublicApi: jest.fn().mockResolvedValue(updatedVariant),
      removeForPublicApi: jest.fn().mockResolvedValue(undefined),
    };
    ordersService = {
      findAllForPublicApi: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'ord-1',
            orderNumber: 'ORD-1',
            status: OrderStatus.PAID,
            paymentMethod: 'promptpay',
            paidAt: new Date('2026-08-01T00:00:00Z'),
            createdAt: new Date('2026-08-01T00:00:00Z'),
            updatedAt: new Date('2026-08-02T00:00:00Z'),
            guestName: 'Somchai',
            guestPhone: '0812345678',
            guestEmail: null,
            customer: null,
            shippingAddress: {
              fullName: 'Somchai',
              phone: '0812345678',
              addressLine1: '1 Road',
              addressLine2: null,
              tumbon: null,
              amphoe: 'Bang Rak',
              province: 'Bangkok',
              postalCode: '10500',
            },
            items: [
              {
                id: 'item-1',
                storeId,
                productName: 'Food',
                variantId: 'var-1',
                variantOptions: {},
                quantity: 1,
                unitPrice: 100,
                subtotal: 100,
                fulfillmentStatus: FulfillmentStatus.PENDING,
                trackingNumber: null,
                fulfillmentProvider: null,
                trackingUrl: null,
                shippedAt: null,
                productVariant: { sku: 'CAT-1' },
              },
            ],
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
    };
    orderFulfillmentService = {
      updateTrackingForPublicApi: jest.fn().mockResolvedValue({
        id: 'ord-1',
        orderNumber: 'ORD-1',
        status: 'shipped',
        paymentMethod: 'promptpay',
        paidAt: new Date('2026-08-01T00:00:00Z'),
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-02T00:00:00Z'),
        guestName: null,
        guestPhone: null,
        guestEmail: null,
        customer: null,
        shippingAddress: null,
        items: [
          {
            id: 'item-1',
            storeId,
            productName: 'Food',
            variantId: 'var-1',
            variantOptions: {},
            quantity: 1,
            unitPrice: 100,
            subtotal: 100,
            fulfillmentStatus: 'shipped',
            trackingNumber: 'TH123',
            fulfillmentProvider: 'Kerry',
            trackingUrl: null,
            shippedAt: new Date('2026-08-02T00:00:00Z'),
            productVariant: { sku: 'CAT-1' },
          },
        ],
      }),
    };
    vendorWebhooksService = {
      getForStore: jest.fn().mockResolvedValue(null),
      upsertForStore: jest.fn().mockResolvedValue({
        id: 'wh-1',
        url: 'https://example.com/hook',
        enabled: true,
        events: [
          'order.create',
          'order.payment_failed',
          'order.paid',
          'order.processing',
          'order.on_hold',
          'order.shipped',
          'order.delivered',
          'order.cancelled',
          'order.refunded',
        ],
        hasSecret: true,
        secret: 'whsec_test',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      deleteForStore: jest.fn().mockResolvedValue(undefined),
    };
    reviewsService = {
      createImportedForPublicApi: jest.fn().mockResolvedValue({
        id: 'rev-1',
        productId: 'prod-1',
        rating: 5,
        comment: 'ดีมาก',
        status: ReviewStatus.PENDING,
        source: ReviewSource.VENDOR_IMPORT,
        customerId: null,
        images: [],
        createdAt: new Date('2026-08-05T00:00:00Z'),
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicApiController],
      providers: [
        ApiKeyGuard,
        ApiKeyRateLimitGuard,
        {
          provide: RedisService,
          useValue: {
            isAvailable: () => false,
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
          },
        },
        { provide: ApiKeysService, useValue: apiKeysService },
        { provide: ProductsService, useValue: productsService },
        { provide: OrdersService, useValue: ordersService },
        { provide: OrderFulfillmentService, useValue: orderFulfillmentService },
        { provide: VendorWebhooksService, useValue: vendorWebhooksService },
        { provide: ReviewsService, useValue: reviewsService },
        { provide: APP_PIPE, useClass: ValidationPipe },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
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

  function postProducts(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .post(`/api/v1/stores/${storeId}/products`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .set(headers)
      .send(body);
  }

  function authPatch(path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .patch(`/api/v1/stores/${storeId}${path}`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .send(body);
  }

  it('POST /api/v1/stores/:storeId/products returns 201 with draft product on valid input', async () => {
    const res = await postProducts(validBody).expect(201);

    expect(res.body.id).toBe('prod-1');
    expect(res.body.status).toBe(ProductStatus.DRAFT);
    expect(res.body.variants).toHaveLength(2);
    expect(productsService.createWithVariants).toHaveBeenCalledWith(
      'user-1',
      storeId,
      expect.objectContaining({
        name: validBody.name,
        category: validBody.category,
        tags: validBody.tags,
        variants: validBody.variants,
        variantItems: validBody.variantItems,
      }),
    );
    expect(apiKeysService.verifyAndAuthenticate).toHaveBeenCalledWith(
      'sopet_sk_valid_key',
      storeId,
    );
  });

  it('GET /api/v1/stores/:storeId/products returns paginated list', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .query({ page: 1, limit: 10 })
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe('prod-1');
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(productsService.findAllForPublicApi).toHaveBeenCalledWith(storeId, {
      page: 1,
      limit: 10,
      status: undefined,
      search: undefined,
    });
  });

  it('GET /products forwards status and search query filters', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .query({ status: ProductStatus.DRAFT, search: 'แมว', page: 2, limit: 5 })
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(200);

    expect(productsService.findAllForPublicApi).toHaveBeenCalledWith(storeId, {
      page: 2,
      limit: 5,
      status: ProductStatus.DRAFT,
      search: 'แมว',
    });
  });

  it('GET /products accepts X-Api-Key header', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .set('X-Api-Key', 'sopet_sk_header_key')
      .expect(200);

    expect(apiKeysService.verifyAndAuthenticate).toHaveBeenCalledWith(
      'sopet_sk_header_key',
      storeId,
    );
  });

  it('GET /products returns 400 for invalid query (limit > 100)', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .query({ limit: 101 })
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

    expect(productsService.findAllForPublicApi).not.toHaveBeenCalled();
  });

  it('GET /products returns 400 for invalid status', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .query({ status: 'deleted' })
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

    expect(productsService.findAllForPublicApi).not.toHaveBeenCalled();
  });

  it('GET /products returns 403 when store is not approved', async () => {
    apiKeysService.verifyAndAuthenticate.mockRejectedValue(
      new ForbiddenException({
        code: 'STORE_SUSPENDED',
        message: 'Store is not approved or is suspended',
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('STORE_SUSPENDED');
      });

    expect(productsService.findAllForPublicApi).not.toHaveBeenCalled();
  });

  it('GET /api/v1/stores/:storeId/products/:productId returns product detail', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products/prod-1`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(200);

    expect(res.body.id).toBe('prod-1');
    expect(res.body.status).toBe(ProductStatus.DRAFT);
    expect(productsService.findOneInStore).toHaveBeenCalledWith('prod-1', storeId);
  });

  it('GET /products/:productId returns 404 PRODUCT_NOT_FOUND', async () => {
    productsService.findOneInStore.mockRejectedValue(
      new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product not found',
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/products/missing`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(404)
      .expect((res) => {
        expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
      });
  });

  it('GET /products/:productId returns 401 when API key is missing', async () => {
    await request(app.getHttpServer()).get(`/api/v1/stores/${storeId}/products/prod-1`).expect(401);

    expect(productsService.findOneInStore).not.toHaveBeenCalled();
  });

  it('GET products returns 401 when API key is missing', async () => {
    await request(app.getHttpServer()).get(`/api/v1/stores/${storeId}/products`).expect(401);

    expect(productsService.findAllForPublicApi).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is missing', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/stores/${storeId}/products`)
      .send(validBody)
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_API_KEY');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', async () => {
    apiKeysService.verifyAndAuthenticate.mockRejectedValue(
      new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      }),
    );

    await postProducts(validBody)
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_API_KEY');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('returns 403 when store is not approved', async () => {
    apiKeysService.verifyAndAuthenticate.mockRejectedValue(
      new ForbiddenException({
        code: 'STORE_SUSPENDED',
        message: 'Store is not approved or is suspended',
      }),
    );

    await postProducts(validBody)
      .expect(403)
      .expect((res) => {
        expect(res.body.error.code).toBe('STORE_SUSPENDED');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('returns 400 for payload missing required variant groups', async () => {
    await postProducts({
      name: 'Incomplete',
      variants: [],
      variantItems: [{ sku: 'A', stock: 1, price: 10, options: { Size: 'S' } }],
    })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('returns 400 for payload missing variant items', async () => {
    await postProducts({
      name: 'Incomplete',
      variants: [{ name: 'Size', values: ['S'] }],
      variantItems: [],
    })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('returns 400 when images contains a non-URL', async () => {
    await postProducts({
      ...validBody,
      images: ['not-a-url'],
    })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

    expect(productsService.createWithVariants).not.toHaveBeenCalled();
  });

  it('passes images URLs through to createWithVariants', async () => {
    const images = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'];
    await postProducts({ ...validBody, images }).expect(201);

    expect(productsService.createWithVariants).toHaveBeenCalledWith(
      'user-1',
      storeId,
      expect.objectContaining({ images }),
    );
  });

  it('accepts X-Api-Key header', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/stores/${storeId}/products`)
      .set('X-Api-Key', 'sopet_sk_header_key')
      .send(validBody)
      .expect(201);

    expect(apiKeysService.verifyAndAuthenticate).toHaveBeenCalledWith(
      'sopet_sk_header_key',
      storeId,
    );
  });

  it('PATCH /products/:productId updates product info', async () => {
    const res = await authPatch('/products/prod-1', {
      name: 'Updated name',
      description: 'Updated desc',
      petType: 'แมว',
    }).expect(200);

    expect(res.body.name).toBe('Updated name');
    expect(productsService.updateProductForPublicApi).toHaveBeenCalledWith(
      'prod-1',
      storeId,
      'user-1',
      expect.objectContaining({
        name: 'Updated name',
        description: 'Updated desc',
        petType: 'แมว',
      }),
    );
  });

  it('PATCH /products/:productId/variants/:variantId updates stock and price', async () => {
    const res = await authPatch('/products/prod-1/variants/var-1', {
      stock: 20,
      price: 549,
    }).expect(200);

    expect(res.body.stockQuantity).toBe(20);
    expect(res.body.price).toBe(549);
    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenCalledWith(
      storeId,
      'user-1',
      {
        variantId: 'var-1',
        productId: 'prod-1',
        stock: 20,
        price: 549,
      },
    );
  });

  it('PATCH /variants/by-sku/:sku updates by sku', async () => {
    await authPatch('/variants/by-sku/TEST-CHK-001', { stock: 7 }).expect(200);

    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenCalledWith(
      storeId,
      'user-1',
      {
        sku: 'TEST-CHK-001',
        stock: 7,
        price: undefined,
      },
    );
  });

  it('PATCH product returns 401 without API key', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/stores/${storeId}/products/prod-1`)
      .send({ name: 'X' })
      .expect(401);

    expect(productsService.updateProductForPublicApi).not.toHaveBeenCalled();
  });

  it('DELETE /products/:productId soft-deletes product', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/stores/${storeId}/products/prod-1`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(204);

    expect(productsService.removeForPublicApi).toHaveBeenCalledWith('prod-1', storeId, 'user-1');
  });

  it('PUT /webhook configures webhook and returns secret once', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/stores/${storeId}/webhook`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .send({
        url: 'https://example.com/hook',
        events: [
          'order.create',
          'order.payment_failed',
          'order.paid',
          'order.processing',
          'order.on_hold',
          'order.shipped',
          'order.delivered',
          'order.cancelled',
          'order.refunded',
        ],
      })
      .expect(200);

    expect(res.body.secret).toBe('whsec_test');
    expect(vendorWebhooksService.upsertForStore).toHaveBeenCalledWith(
      storeId,
      expect.objectContaining({ url: 'https://example.com/hook' }),
    );
  });

  it('GET /orders lists store-scoped orders with filters', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/stores/${storeId}/orders`)
      .query({
        page: 1,
        limit: 20,
        status: OrderStatus.PAID,
        fulfillmentStatus: FulfillmentStatus.PENDING,
        updatedSince: '2026-08-01T00:00:00.000Z',
      })
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].orderId).toBe('ord-1');
    expect(res.body.items[0].items[0].sku).toBe('CAT-1');
    expect(res.body.pagination.total).toBe(1);
    expect(ordersService.findAllForPublicApi).toHaveBeenCalledWith(storeId, {
      page: 1,
      limit: 20,
      status: OrderStatus.PAID,
      fulfillmentStatus: FulfillmentStatus.PENDING,
      updatedSince: '2026-08-01T00:00:00.000Z',
      createdSince: undefined,
      createdUntil: undefined,
    });
  });

  it('PATCH /orders/:orderId/tracking updates tracking', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/stores/${storeId}/orders/ord-1/tracking`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .send({ trackingNumber: 'TH123', fulfillmentProvider: 'Kerry' })
      .expect(200);

    expect(res.body.id).toBe('ord-1');
    expect(res.body.items[0].trackingNumber).toBe('TH123');
    expect(orderFulfillmentService.updateTrackingForPublicApi).toHaveBeenCalledWith(
      'user-1',
      storeId,
      'ord-1',
      'TH123',
      'Kerry',
      undefined,
    );
  });

  it('POST /products/:productId/reviews imports pending unknown-customer review', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/stores/${storeId}/products/prod-1/reviews`)
      .set('Authorization', 'Bearer sopet_sk_valid_key')
      .send({ rating: 5, comment: 'ดีมาก' })
      .expect(201);

    expect(res.body.id).toBe('rev-1');
    expect(res.body.status).toBe(ReviewStatus.PENDING);
    expect(res.body.source).toBe(ReviewSource.VENDOR_IMPORT);
    expect(res.body.customerName).toBe('ลูกค้าไม่ระบุชื่อ');
    expect(reviewsService.createImportedForPublicApi).toHaveBeenCalledWith(
      storeId,
      'user-1',
      'prod-1',
      { rating: 5, comment: 'ดีมาก', imageUrls: undefined },
    );
  });
});
