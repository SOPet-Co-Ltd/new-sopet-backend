import { NotFoundException } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { OrderFulfillmentService } from '../orders/order-fulfillment.service';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { ReviewsService } from '../reviews/reviews.service';
import { ProductStatus } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/order.entity';
import { FulfillmentStatus } from '../../database/entities/order-item.entity';
import { ReviewSource, ReviewStatus } from '../../database/entities/review.entity';
import { CreatePublicProductDto } from './dto/create-public-product.dto';
import { UpdatePublicProductDto, UpdatePublicVariantDto } from './dto/update-public-product.dto';

describe('PublicApiController', () => {
  let controller: PublicApiController;
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

  const apiKeyAuth = {
    storeId: 'store-1',
    keyId: 'key-1',
    createdBy: 'user-1',
  };

  const dto: CreatePublicProductDto = {
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
    storeId: 'store-1',
    name: dto.name,
    slug: 'test-product',
    description: dto.description,
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

  beforeEach(() => {
    productsService = {
      createWithVariants: jest.fn().mockResolvedValue(createdProduct),
      findAllForPublicApi: jest.fn().mockResolvedValue({
        items: [createdProduct],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
      findOneInStore: jest.fn().mockResolvedValue(createdProduct),
      updateProductForPublicApi: jest.fn().mockResolvedValue({
        ...createdProduct,
        name: 'Updated',
      }),
      updateVariantStockPriceForPublicApi: jest.fn().mockResolvedValue({
        id: 'var-1',
        sku: 'TEST-CHK-001',
        stockQuantity: 20,
        priceAdjustment: 50,
        product: { basePrice: 499 },
      }),
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
                storeId: 'store-1',
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
            storeId: 'store-1',
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
      getForStore: jest.fn().mockResolvedValue({
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
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      upsertForStore: jest.fn().mockResolvedValue({
        id: 'wh-1',
        url: 'https://example.com/hook',
        enabled: true,
        events: ['order.paid'],
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
    controller = new PublicApiController(
      productsService as unknown as ProductsService,
      ordersService as unknown as OrdersService,
      orderFulfillmentService as unknown as OrderFulfillmentService,
      vendorWebhooksService as unknown as VendorWebhooksService,
      reviewsService as unknown as ReviewsService,
    );
  });

  it('delegates product list and maps items', async () => {
    const result = await controller.listProducts('store-1', { page: 1, limit: 20 });

    expect(productsService.findAllForPublicApi).toHaveBeenCalledWith('store-1', {
      page: 1,
      limit: 20,
      status: undefined,
      search: undefined,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('prod-1');
    expect(result.pagination.total).toBe(1);
  });

  it('delegates product list with status and search', async () => {
    await controller.listProducts('store-1', {
      page: 3,
      limit: 50,
      status: ProductStatus.PUBLISHED,
      search: 'organic',
    });

    expect(productsService.findAllForPublicApi).toHaveBeenCalledWith('store-1', {
      page: 3,
      limit: 50,
      status: ProductStatus.PUBLISHED,
      search: 'organic',
    });
  });

  it('delegates product detail by id', async () => {
    const result = await controller.getProduct('store-1', 'prod-1');

    expect(productsService.findOneInStore).toHaveBeenCalledWith('prod-1', 'store-1');
    expect(result.id).toBe('prod-1');
  });

  it('propagates PRODUCT_NOT_FOUND from findOneInStore', async () => {
    productsService.findOneInStore.mockRejectedValueOnce(
      new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
    );

    await expect(controller.getProduct('store-1', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('delegates to createWithVariants with mapped payload and returns mapped product', async () => {
    const result = await controller.createProduct('store-1', dto, apiKeyAuth);

    expect(result.id).toBe('prod-1');
    expect(productsService.createWithVariants).toHaveBeenCalledWith(
      'user-1',
      'store-1',
      expect.objectContaining({ name: dto.name }),
    );
  });

  it('delegates product info updates', async () => {
    const patch: UpdatePublicProductDto = { name: 'Updated' };
    await controller.updateProduct('store-1', 'prod-1', patch, apiKeyAuth);
    expect(productsService.updateProductForPublicApi).toHaveBeenCalledWith(
      'prod-1',
      'store-1',
      'user-1',
      expect.objectContaining({ name: 'Updated' }),
    );
  });

  it('delegates variant updates by id and sku', async () => {
    const body: UpdatePublicVariantDto = { stock: 20, price: 549 };
    await controller.updateVariantById('store-1', 'prod-1', 'var-1', body, apiKeyAuth);
    await controller.updateVariantBySku('store-1', 'CAT%2FSKU', body, apiKeyAuth);

    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenCalledTimes(2);
    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenLastCalledWith(
      'store-1',
      'user-1',
      expect.objectContaining({ sku: 'CAT/SKU' }),
    );
  });

  it('delegates product delete', async () => {
    await controller.deleteProduct('store-1', 'prod-1', apiKeyAuth);
    expect(productsService.removeForPublicApi).toHaveBeenCalledWith('prod-1', 'store-1', 'user-1');
  });

  it('delegates webhook upsert/get/delete', async () => {
    await controller.upsertWebhook('store-1', {
      url: 'https://example.com/hook',
      events: ['order.paid'],
    });
    await controller.getWebhook('store-1');
    await controller.deleteWebhook('store-1');

    expect(vendorWebhooksService.upsertForStore).toHaveBeenCalled();
    expect(vendorWebhooksService.getForStore).toHaveBeenCalledWith('store-1');
    expect(vendorWebhooksService.deleteForStore).toHaveBeenCalledWith('store-1');
  });

  it('delegates order list and maps store-scoped items', async () => {
    const result = await controller.listOrders('store-1', {
      page: 1,
      limit: 20,
      status: OrderStatus.PAID,
      fulfillmentStatus: FulfillmentStatus.PENDING,
      updatedSince: '2026-08-01T00:00:00.000Z',
    });

    expect(ordersService.findAllForPublicApi).toHaveBeenCalledWith('store-1', {
      page: 1,
      limit: 20,
      status: OrderStatus.PAID,
      fulfillmentStatus: FulfillmentStatus.PENDING,
      updatedSince: '2026-08-01T00:00:00.000Z',
      createdSince: undefined,
      createdUntil: undefined,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].orderId).toBe('ord-1');
    expect(result.items[0].items[0].sku).toBe('CAT-1');
    expect(result.pagination.total).toBe(1);
  });

  it('delegates tracking update and returns store-scoped order', async () => {
    const result = await controller.updateOrderTracking(
      'store-1',
      'ord-1',
      { trackingNumber: 'TH123', fulfillmentProvider: 'Kerry' },
      apiKeyAuth,
    );

    expect(orderFulfillmentService.updateTrackingForPublicApi).toHaveBeenCalledWith(
      'user-1',
      'store-1',
      'ord-1',
      'TH123',
      'Kerry',
      undefined,
    );
    expect(result.id).toBe('ord-1');
    expect(result.items[0].trackingNumber).toBe('TH123');
  });

  it('delegates imported review create', async () => {
    const result = await controller.createImportedReview(
      'store-1',
      'prod-1',
      { rating: 5, comment: 'ดีมาก' },
      apiKeyAuth,
    );

    expect(reviewsService.createImportedForPublicApi).toHaveBeenCalledWith(
      'store-1',
      'user-1',
      'prod-1',
      { rating: 5, comment: 'ดีมาก', imageUrls: undefined },
    );
    expect(result.status).toBe(ReviewStatus.PENDING);
    expect(result.source).toBe(ReviewSource.VENDOR_IMPORT);
    expect(result.customerName).toBe('ลูกค้าไม่ระบุชื่อ');
  });
});
