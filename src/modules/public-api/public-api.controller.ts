import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { ApiKeyRateLimitGuard } from '../api-keys/guards/api-key-rate-limit.guard';
import { ApiKeyAuth, ApiKeyAuthContext } from '../api-keys/decorators/api-key-auth.decorator';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';
import { OrderFulfillmentService } from '../orders/order-fulfillment.service';
import { VendorWebhooksService } from '../vendor-webhooks/vendor-webhooks.service';
import { ReviewsService, resolveReviewCustomerName } from '../reviews/reviews.service';
import { CreatePublicProductDto } from './dto/create-public-product.dto';
import { CreatePublicReviewDto } from './dto/create-public-review.dto';
import { ListPublicOrdersQueryDto } from './dto/list-public-orders-query.dto';
import { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import { UpdatePublicProductDto, UpdatePublicVariantDto } from './dto/update-public-product.dto';
import {
  UpdatePublicOrderTrackingDto,
  UpsertPublicWebhookDto,
} from './dto/upsert-public-webhook.dto';
import { mapProduct, mapVariant } from '../../graphql/models/mappers';
import { ProductType, ProductVariantType } from '../../graphql/models/types';
import { mapPublicApiOrder } from './public-api-order.mapper';
import { PaginatedResponse } from '../../common/interfaces';
import {
  ImportDataService,
  mapImportedAddress,
  mapImportedCustomer,
  mapImportedOrder,
} from './import-data.service';
import { AnalyticsService } from '../analytics/analytics.service';
import {
  CreateImportedAddressDto,
  CreateImportedCustomerDto,
} from './dto/create-imported-customer.dto';
import { CreateImportedOrderDto } from './dto/create-imported-order.dto';
import { ListImportedQueryDto, ListPublicReviewsQueryDto } from './dto/list-imported-query.dto';
import { ReviewSource, ReviewStatus } from '../../database/entities/review.entity';

@Controller('api/v1/stores/:storeId')
@Public()
@UseGuards(ApiKeyGuard, ApiKeyRateLimitGuard)
export class PublicApiController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
    private readonly orderFulfillmentService: OrderFulfillmentService,
    private readonly vendorWebhooksService: VendorWebhooksService,
    private readonly reviewsService: ReviewsService,
    private readonly importDataService: ImportDataService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  private async withSoldCount<T extends { id: string }>(
    product: T,
  ): Promise<T & { soldCount: number }> {
    const [soldCount] = await this.analyticsService.getProductSoldCounts([product.id]);
    return { ...product, soldCount };
  }

  private async withSoldCounts<T extends { id: string }>(
    products: T[],
  ): Promise<Array<T & { soldCount: number }>> {
    if (products.length === 0) {
      return [];
    }
    const counts = await this.analyticsService.getProductSoldCounts(products.map((p) => p.id));
    return products.map((product, index) => ({ ...product, soldCount: counts[index] ?? 0 }));
  }

  @Get('products')
  async listProducts(
    @Param('storeId') storeId: string,
    @Query() query: ListPublicProductsQueryDto,
  ): Promise<PaginatedResponse<ProductType & { soldCount: number }>> {
    const result = await this.productsService.findAllForPublicApi(storeId, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      search: query.search,
    });
    const items = await this.withSoldCounts(result.items.map(mapProduct));
    return {
      items,
      pagination: result.pagination,
    };
  }

  @Get('products/:productId')
  async getProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ): Promise<ProductType & { soldCount: number }> {
    const product = await this.productsService.findOneInStore(productId, storeId);
    return this.withSoldCount(mapProduct(product));
  }

  @Post('products')
  @HttpCode(201)
  async createProduct(
    @Param('storeId') storeId: string,
    @Body() dto: CreatePublicProductDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductType & { soldCount: number }> {
    const product = await this.productsService.createWithVariants(apiKeyAuth.createdBy, storeId, {
      name: dto.name,
      description: dto.description,
      warning: dto.warning,
      expiryDate: dto.expiryDate,
      category: dto.category,
      tags: dto.tags,
      petType: dto.petType,
      brand: dto.brand,
      images: dto.images,
      variants: dto.variants.map((group) => ({
        name: group.name,
        values: group.values,
      })),
      variantItems: dto.variantItems.map((item) => ({
        sku: item.sku,
        stock: item.stock,
        price: item.price,
        options: item.options,
      })),
    });
    return this.withSoldCount(mapProduct(product));
  }

  @Patch('products/:productId')
  async updateProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdatePublicProductDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductType & { soldCount: number }> {
    const product = await this.productsService.updateProductForPublicApi(
      productId,
      storeId,
      apiKeyAuth.createdBy,
      {
        name: dto.name,
        description: dto.description,
        warning: dto.warning,
        expiryDate: dto.expiryDate,
        category: dto.category,
        tags: dto.tags,
        petType: dto.petType,
        brand: dto.brand,
        images: dto.images,
      },
    );
    return this.withSoldCount(mapProduct(product));
  }

  @Delete('products/:productId')
  @HttpCode(204)
  async deleteProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<void> {
    await this.productsService.removeForPublicApi(productId, storeId, apiKeyAuth.createdBy);
  }

  @Post('products/:productId/reviews')
  @HttpCode(201)
  async createImportedReview(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: CreatePublicReviewDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const review = await this.reviewsService.createImportedForPublicApi(
      storeId,
      apiKeyAuth.createdBy,
      productId,
      {
        rating: dto.rating,
        comment: dto.comment,
        imageUrls: dto.images,
      },
    );
    return {
      id: review.id,
      productId: review.productId,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      source: review.source,
      customerName: resolveReviewCustomerName(review),
      images: (review.images ?? []).map((image) => ({ id: image.id, url: image.url })),
      createdAt: review.createdAt,
    };
  }

  @Patch('products/:productId/variants/:variantId')
  async updateVariantById(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdatePublicVariantDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductVariantType> {
    const variant = await this.productsService.updateVariantStockPriceForPublicApi(
      storeId,
      apiKeyAuth.createdBy,
      {
        variantId,
        productId,
        stock: dto.stock,
        price: dto.price,
      },
    );
    return mapVariant(variant, Number(variant.product.basePrice ?? 0));
  }

  @Patch('variants/by-sku/:sku')
  async updateVariantBySku(
    @Param('storeId') storeId: string,
    @Param('sku') sku: string,
    @Body() dto: UpdatePublicVariantDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductVariantType> {
    const variant = await this.productsService.updateVariantStockPriceForPublicApi(
      storeId,
      apiKeyAuth.createdBy,
      {
        sku: decodeURIComponent(sku),
        stock: dto.stock,
        price: dto.price,
      },
    );
    return mapVariant(variant, Number(variant.product.basePrice ?? 0));
  }

  @Get('webhook')
  async getWebhook(@Param('storeId') storeId: string) {
    const webhook = await this.vendorWebhooksService.getForStore(storeId);
    if (!webhook) {
      throw new NotFoundException({
        code: 'WEBHOOK_NOT_FOUND',
        message: 'Webhook not configured for this store',
      });
    }
    return webhook;
  }

  @Put('webhook')
  async upsertWebhook(@Param('storeId') storeId: string, @Body() dto: UpsertPublicWebhookDto) {
    return this.vendorWebhooksService.upsertForStore(storeId, {
      url: dto.url,
      events: dto.events,
      enabled: dto.enabled,
      rotateSecret: dto.rotateSecret,
    });
  }

  @Delete('webhook')
  @HttpCode(204)
  async deleteWebhook(@Param('storeId') storeId: string): Promise<void> {
    await this.vendorWebhooksService.deleteForStore(storeId);
  }

  @Get('orders')
  async listOrders(
    @Param('storeId') storeId: string,
    @Query() query: ListPublicOrdersQueryDto,
  ): Promise<PaginatedResponse<ReturnType<typeof mapPublicApiOrder>>> {
    const result = await this.ordersService.findAllForPublicApi(storeId, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      fulfillmentStatus: query.fulfillmentStatus,
      updatedSince: query.updatedSince,
      createdSince: query.createdSince,
      createdUntil: query.createdUntil,
    });
    return {
      items: result.items.map((order) => mapPublicApiOrder(order, storeId)),
      pagination: result.pagination,
    };
  }

  @Patch('orders/:orderId/tracking')
  async updateOrderTracking(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdatePublicOrderTrackingDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const order = await this.orderFulfillmentService.updateTrackingForPublicApi(
      apiKeyAuth.createdBy,
      storeId,
      orderId,
      dto.trackingNumber,
      dto.fulfillmentProvider,
      dto.trackingUrl,
    );
    return mapPublicApiOrder(order, storeId);
  }

  @Post('imported-customers')
  @HttpCode(201)
  async createImportedCustomer(
    @Param('storeId') storeId: string,
    @Body() dto: CreateImportedCustomerDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const customer = await this.importDataService.createImportedCustomer(
      storeId,
      apiKeyAuth.createdBy,
      dto,
    );
    return mapImportedCustomer(customer);
  }

  @Get('imported-customers')
  async listImportedCustomers(
    @Param('storeId') storeId: string,
    @Query() query: ListImportedQueryDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const result = await this.importDataService.listImportedCustomers(
      storeId,
      apiKeyAuth.createdBy,
      query.page,
      query.limit,
    );
    return {
      items: result.items.map(mapImportedCustomer),
      pagination: result.pagination,
    };
  }

  @Post('imported-customers/:customerId/addresses')
  @HttpCode(201)
  async createImportedAddress(
    @Param('storeId') storeId: string,
    @Param('customerId') customerId: string,
    @Body() dto: CreateImportedAddressDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const address = await this.importDataService.createImportedAddress(
      storeId,
      apiKeyAuth.createdBy,
      customerId,
      dto,
    );
    return mapImportedAddress(address);
  }

  @Get('imported-customers/:customerId/addresses')
  async listImportedAddresses(
    @Param('storeId') storeId: string,
    @Param('customerId') customerId: string,
    @Query() query: ListImportedQueryDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const result = await this.importDataService.listImportedAddresses(
      storeId,
      apiKeyAuth.createdBy,
      customerId,
      query.page,
      query.limit,
    );
    return {
      items: result.items.map(mapImportedAddress),
      pagination: result.pagination,
    };
  }

  @Post('imported-orders')
  @HttpCode(201)
  async createImportedOrder(
    @Param('storeId') storeId: string,
    @Body() dto: CreateImportedOrderDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const order = await this.importDataService.createImportedOrder(
      storeId,
      apiKeyAuth.createdBy,
      dto,
    );
    return mapImportedOrder(order, storeId);
  }

  @Get('imported-orders')
  async listImportedOrders(
    @Param('storeId') storeId: string,
    @Query() query: ListImportedQueryDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const result = await this.importDataService.listImportedOrders(
      storeId,
      apiKeyAuth.createdBy,
      query.page,
      query.limit,
    );
    return {
      items: result.items.map((order) => mapImportedOrder(order, storeId)),
      pagination: result.pagination,
    };
  }

  @Get('reviews')
  async listReviews(
    @Param('storeId') storeId: string,
    @Query() query: ListPublicReviewsQueryDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ) {
    const result = await this.reviewsService.listForPublicApi(storeId, apiKeyAuth.createdBy, {
      page: query.page,
      limit: query.limit,
      productId: query.productId,
      status: query.status as ReviewStatus | undefined,
      source: query.source as ReviewSource | undefined,
    });
    return {
      items: result.items.map((review) => ({
        id: review.id,
        productId: review.productId,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        source: review.source,
        customerName: resolveReviewCustomerName(review),
        images: (review.images ?? []).map((image) => ({ id: image.id, url: image.url })),
        createdAt: review.createdAt,
      })),
      pagination: result.pagination,
    };
  }

  @Delete('reviews/:reviewId')
  @HttpCode(204)
  async deleteReview(
    @Param('storeId') storeId: string,
    @Param('reviewId') reviewId: string,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<void> {
    await this.reviewsService.softDeleteImportedForPublicApi(
      storeId,
      apiKeyAuth.createdBy,
      reviewId,
    );
  }
}
