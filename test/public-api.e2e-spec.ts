import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { PublicApiController } from '../src/modules/public-api/public-api.controller';
import { ApiKeyGuard } from '../src/modules/api-keys/guards/api-key.guard';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { ProductsService } from '../src/modules/products/products.service';
import { ValidationPipe } from '../src/common/pipes/validation.pipe';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ProductStatus } from '../src/database/entities/product.entity';

describe('Public API products (e2e)', () => {
  let app: INestApplication<App>;
  let apiKeysService: { verifyAndAuthenticate: jest.Mock };
  let productsService: {
    createWithVariants: jest.Mock;
    updateProductForPublicApi: jest.Mock;
    updateVariantStockPriceForPublicApi: jest.Mock;
  };

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
      updateProductForPublicApi: jest.fn().mockResolvedValue({
        ...createdProduct,
        name: 'Updated name',
        description: 'Updated desc',
      }),
      updateVariantStockPriceForPublicApi: jest.fn().mockResolvedValue(updatedVariant),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PublicApiController],
      providers: [
        ApiKeyGuard,
        { provide: ApiKeysService, useValue: apiKeysService },
        { provide: ProductsService, useValue: productsService },
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
});
