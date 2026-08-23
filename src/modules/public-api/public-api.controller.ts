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
  ) {}

  @Get('products')
  async listProducts(
    @Param('storeId') storeId: string,
    @Query() query: ListPublicProductsQueryDto,
  ): Promise<PaginatedResponse<ProductType>> {
    const result = await this.productsService.findAllForPublicApi(storeId, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      search: query.search,
    });
    return {
      items: result.items.map(mapProduct),
      pagination: result.pagination,
    };
  }

  @Get('products/:productId')
  async getProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ): Promise<ProductType> {
    const product = await this.productsService.findOneInStore(productId, storeId);
    return mapProduct(product);
  }

  @Post('products')
  @HttpCode(201)
  async createProduct(
    @Param('storeId') storeId: string,
    @Body() dto: CreatePublicProductDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductType> {
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
    return mapProduct(product);
  }

  @Patch('products/:productId')
  async updateProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() dto: UpdatePublicProductDto,
    @ApiKeyAuth() apiKeyAuth: ApiKeyAuthContext,
  ): Promise<ProductType> {
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
    return mapProduct(product);
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
}
