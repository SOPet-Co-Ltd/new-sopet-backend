import {
  Args,
  Field,
  Float,
  ID,
  InputType,
  Int,
  Context,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';
import { seededShuffle } from '../../common/utils/seeded-shuffle';
import { AnalyticsService } from '../analytics/analytics.service';
import { SearchContextInput } from '../search/search.inputs';
import { PersonalizationService } from '../search/personalization.service';
import { SearchAnalyticsService } from '../search/search-analytics.service';
import { SearchRepository } from '../search/search.repository';
import { SearchSettingsService } from '../search/search-settings.service';
import { ProductsService } from './products.service';
import {
  AddProductImageInput,
  CreateProductVariantInput,
  SyncProductVariantItemInput,
  UpdateProductImageInput,
  UpdateProductVariantInput,
} from './products.inputs';
import {
  ProductConnection,
  ProductImageType,
  ProductPublishChecklistType,
  ProductType,
  ProductVariantType,
} from '../../graphql/models/types';
import { mapImage, mapProduct, mapVariant } from '../../graphql/models/mappers';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProductStatus } from '../../database/entities/product.entity';

const PUBLIC_PRODUCTS_MAX_LIMIT = 100;

function clampPublicProductsLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? 20, 1), PUBLIC_PRODUCTS_MAX_LIMIT);
}

function parseVariantAttributes(attributes?: string): Record<string, any> | undefined {
  if (!attributes) {
    return undefined;
  }

  return JSON.parse(attributes) as Record<string, any>;
}

@InputType()
export class CreateProductInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  basePrice!: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tagIds?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  petTypeId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  brandId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  warning?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}

@InputType()
export class UpdateProductInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  basePrice?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  status?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  tagIds?: string[];

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  petTypeId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  brandId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  warning?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}

function getOptionalUserId(context: GraphqlContext): string | undefined {
  const request = context.req as { user?: { id?: string } } | undefined;
  const userId = request?.user?.id;
  return typeof userId === 'string' ? userId : undefined;
}

@Resolver(() => ProductType)
export class ProductsResolver {
  constructor(
    private readonly productsService: ProductsService,
    private readonly analyticsService: AnalyticsService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
    private readonly searchRepository: SearchRepository,
    private readonly personalizationService: PersonalizationService,
    private readonly searchSettingsService: SearchSettingsService,
  ) {}

  @ResolveField(() => Int)
  async soldCount(
    @Parent() product: ProductType,
    @Context() context: GraphqlContext,
  ): Promise<number> {
    return context.loaders.productSoldCount.load(product.id);
  }

  @Query(() => ProductConnection)
  @Public()
  async products(
    @Args('search', { nullable: true }) search?: string,
    @Args('storeId', { nullable: true }) storeId?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('tag', { nullable: true }) tag?: string,
    @Args('petTypeIds', { type: () => [String], nullable: true }) petTypeIds?: string[],
    @Args('brandIds', { type: () => [String], nullable: true }) brandIds?: string[],
    @Args('minPrice', { type: () => Int, nullable: true }) minPrice?: number,
    @Args('maxPrice', { type: () => Int, nullable: true }) maxPrice?: number,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
    @Args('sortBy', { nullable: true }) sortBy?: string,
    @Args('sortOrder', { nullable: true }) sortOrder?: 'ASC' | 'DESC',
    @Args('sessionId', { nullable: true }) sessionId?: string,
    @Args('searchContext', { nullable: true }) searchContext?: SearchContextInput,
    @Context() context?: GraphqlContext,
  ): Promise<ProductConnection> {
    const cappedLimit = clampPublicProductsLimit(limit);
    const startedAt = Date.now();
    const userId = context ? getOptionalUserId(context) : undefined;
    const result = await this.productsService.findAll({
      search,
      storeId,
      category,
      tag,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
      status: ProductStatus.PUBLISHED,
      page,
      limit: cappedLimit,
      sortBy,
      sortOrder,
      sessionId,
      searchContext,
      userId,
    });

    if (search?.trim()) {
      this.searchAnalyticsService.recordSearchEvent({
        query: search.trim(),
        resultCount: result.pagination.total,
        latencyMs: Date.now() - startedAt,
        filters: {
          storeId,
          category,
          tag,
          petTypeIds,
          brandIds,
          minPrice,
          maxPrice,
          sortBy,
          sortOrder,
        },
        sessionId,
        userId,
      });
    }

    return {
      items: result.items.map(mapProduct),
      pagination: result.pagination,
    };
  }

  @Query(() => [ProductType])
  @Public()
  async recommendedProducts(
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
    @Args('sessionId', { nullable: true }) sessionId?: string,
    @Args('searchContext', { nullable: true }) searchContext?: SearchContextInput,
    @Args('excludeProductIds', { type: () => [String], nullable: true })
    excludeProductIds?: string[],
    @Args('shuffleSeed', { nullable: true }) shuffleSeed?: string,
    @Context() context?: GraphqlContext,
  ): Promise<ProductType[]> {
    const cappedLimit = Math.min(Math.max(limit ?? 50, 1), 50);
    const poolLimit = Math.min(cappedLimit * 3, 50);
    const topProducts = await this.analyticsService.getPlatformTopProducts(poolLimit);
    const productIds = topProducts.map((item) => item.productId);
    let products = await this.productsService.findPublishedByIds(productIds);

    // Backfill with recently published products when there is little or no sales
    // history, so the storefront always has products to recommend.
    if (products.length < poolLimit) {
      const seenIds = new Set(products.map((product) => product.id));
      const { items: latestProducts } = await this.productsService.findAll({
        status: ProductStatus.PUBLISHED,
        page: 1,
        limit: poolLimit,
      });
      for (const product of latestProducts) {
        if (products.length >= poolLimit) {
          break;
        }
        if (!seenIds.has(product.id)) {
          products.push(product);
          seenIds.add(product.id);
        }
      }
    }

    const excludeSet = new Set(excludeProductIds ?? []);
    products = products.filter((product) => !excludeSet.has(product.id));

    const userId = context ? getOptionalUserId(context) : undefined;
    let orderedProducts = products;

    if ((sessionId || searchContext || userId) && products.length > 1) {
      const recentProductIds = searchContext?.recentProductIds ?? [];
      const recentMeta =
        recentProductIds.length > 0
          ? await this.searchRepository.fetchProductPersonalizationMeta(recentProductIds)
          : [];
      const profile = await this.personalizationService.buildProfile(
        userId,
        searchContext,
        recentMeta,
      );
      const weights = await this.searchSettingsService.getRankingWeights();
      const metaRows = await this.searchRepository.fetchProductPersonalizationMeta(
        products.map((product) => product.id),
      );
      const productsById = new Map(metaRows.map((row) => [row.id, row]));
      const scoreById = new Map(
        products.map((product, index) => [product.id, products.length - index]),
      );
      const orderedIds = this.personalizationService.reorderIds(
        products.map((product) => product.id),
        scoreById,
        productsById,
        profile,
        weights.personalizationCap,
      );
      const productsByIdEntity = new Map(products.map((product) => [product.id, product]));
      orderedProducts = orderedIds
        .map((id) => productsByIdEntity.get(id))
        .filter((product): product is NonNullable<typeof product> => Boolean(product));
    }

    const seed = shuffleSeed?.trim() || `${Date.now()}`;
    const shuffledProducts = seededShuffle(orderedProducts, seed);

    return shuffledProducts.slice(0, cappedLimit).map(mapProduct);
  }

  @Query(() => ProductType)
  @Public()
  async product(@Args('id') id: string): Promise<ProductType> {
    const product = await this.productsService.findOnePublished(id);
    return mapProduct(product);
  }

  @Query(() => ProductType)
  @Public()
  async productBySlug(
    @Args('storeId') storeId: string,
    @Args('slug') slug: string,
  ): Promise<ProductType> {
    const product = await this.productsService.findBySlugPublished(storeId, slug);
    return mapProduct(product);
  }

  @Query(() => ProductType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorProduct(
    @CurrentUser('id') userId: string,
    @Args('id') id: string,
  ): Promise<ProductType> {
    const product = await this.productsService.findOne(id);
    await this.productsService.resolveActiveStoreId(userId, product.storeId);
    return mapProduct(product);
  }

  @Query(() => ProductPublishChecklistType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async productPublishChecklist(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
  ): Promise<ProductPublishChecklistType> {
    const product = await this.productsService.findOne(productId);
    await this.productsService.resolveActiveStoreId(userId, product.storeId);
    return this.productsService.getPublishChecklist(product);
  }

  @Query(() => ProductConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async vendorProducts(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
    @Args('search', { nullable: true }) search?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('petTypeIds', { type: () => [String], nullable: true }) petTypeIds?: string[],
    @Args('brandIds', { type: () => [String], nullable: true }) brandIds?: string[],
    @Args('minPrice', { type: () => Float, nullable: true }) minPrice?: number,
    @Args('maxPrice', { type: () => Float, nullable: true }) maxPrice?: number,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<ProductConnection> {
    const activeStoreId = await this.productsService.resolveActiveStoreId(userId, storeId);
    const cappedLimit = clampPublicProductsLimit(limit);

    const result = await this.productsService.findAll({
      search,
      storeId: activeStoreId,
      category,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
      allStatuses: true,
      page,
      limit: cappedLimit,
    });

    return {
      items: result.items.map(mapProduct),
      pagination: result.pagination,
    };
  }

  @Mutation(() => ProductType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createProduct(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
    @Args('input') input: CreateProductInput,
  ): Promise<ProductType> {
    const activeStoreId = await this.productsService.resolveActiveStoreId(userId, storeId);
    const product = await this.productsService.create(userId, activeStoreId, {
      name: input.name,
      description: input.description,
      basePrice: input.basePrice,
      compareAtPrice: input.compareAtPrice,
      category: input.category,
      categoryId: input.categoryId,
      tags: input.tags,
      tagIds: input.tagIds,
      petTypeId: input.petTypeId,
      brandId: input.brandId,
      warning: input.warning,
      expiryDate: input.expiryDate,
    });
    return mapProduct(product);
  }

  @Mutation(() => ProductType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async publishProduct(
    @CurrentUser('id') userId: string,
    @Args('id') id: string,
  ): Promise<ProductType> {
    const product = await this.productsService.publish(id, userId);
    return mapProduct(product);
  }

  @Mutation(() => ProductType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateProduct(
    @CurrentUser('id') userId: string,
    @Args('id') id: string,
    @Args('input') input: UpdateProductInput,
  ): Promise<ProductType> {
    const product = await this.productsService.update(id, userId, {
      name: input.name,
      description: input.description,
      basePrice: input.basePrice,
      compareAtPrice: input.compareAtPrice,
      status: input.status as ProductStatus | undefined,
      category: input.category,
      categoryId: input.categoryId,
      tags: input.tags,
      tagIds: input.tagIds,
      petTypeId: input.petTypeId,
      brandId: input.brandId,
      warning: input.warning,
      expiryDate: input.expiryDate,
    });
    return mapProduct(product);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async deleteProduct(@CurrentUser('id') userId: string, @Args('id') id: string): Promise<boolean> {
    await this.productsService.remove(id, userId);
    return true;
  }

  @Mutation(() => ProductVariantType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createProductVariant(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
    @Args('input') input: CreateProductVariantInput,
  ): Promise<ProductVariantType> {
    const variant = await this.productsService.addVariant(productId, userId, {
      name: input.name,
      sku: input.sku,
      priceModifier: input.priceModifier,
      stockQuantity: input.stockQuantity,
      attributes: parseVariantAttributes(input.attributes),
    });
    const product = await this.productsService.findOne(productId);
    return mapVariant(variant, product.basePrice);
  }

  @Mutation(() => ProductVariantType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateProductVariant(
    @CurrentUser('id') userId: string,
    @Args('variantId') variantId: string,
    @Args('input') input: UpdateProductVariantInput,
  ): Promise<ProductVariantType> {
    const variant = await this.productsService.updateVariant(variantId, userId, {
      name: input.name,
      sku: input.sku,
      priceModifier: input.priceModifier,
      stockQuantity: input.stockQuantity,
      attributes: parseVariantAttributes(input.attributes),
    });
    return mapVariant(variant, variant.product.basePrice);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async deleteProductVariant(
    @CurrentUser('id') userId: string,
    @Args('variantId') variantId: string,
  ): Promise<boolean> {
    await this.productsService.removeVariant(variantId, userId);
    return true;
  }

  @Mutation(() => [ProductVariantType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async syncProductVariants(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
    @Args('variants', { type: () => [SyncProductVariantItemInput] })
    variants: SyncProductVariantItemInput[],
  ): Promise<ProductVariantType[]> {
    const product = await this.productsService.findOne(productId);
    const saved = await this.productsService.syncVariants(
      productId,
      userId,
      variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        stockQuantity: variant.stockQuantity,
        priceModifier: variant.priceModifier,
        attributes: parseVariantAttributes(variant.attributes) ?? {},
      })),
    );
    return saved.map((variant) => mapVariant(variant, product.basePrice));
  }

  @Mutation(() => ProductImageType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async addProductImage(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
    @Args('input') input: AddProductImageInput,
  ): Promise<ProductImageType> {
    const image = await this.productsService.addImage(
      productId,
      userId,
      input.url,
      input.sortOrder ?? 0,
      input.altText,
      input.isThumbnail,
    );
    return mapImage(image);
  }

  @Mutation(() => ProductImageType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateProductImage(
    @CurrentUser('id') userId: string,
    @Args('imageId') imageId: string,
    @Args('input') input: UpdateProductImageInput,
  ): Promise<ProductImageType> {
    const image = await this.productsService.updateImage(imageId, userId, {
      sortOrder: input.sortOrder,
      altText: input.altText,
      isThumbnail: input.isThumbnail,
    });
    return mapImage(image);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async deleteProductImage(
    @CurrentUser('id') userId: string,
    @Args('imageId') imageId: string,
  ): Promise<boolean> {
    await this.productsService.removeImage(imageId, userId);
    return true;
  }

  @Mutation(() => [ProductImageType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async reorderProductImages(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
    @Args({ name: 'imageIds', type: () => [ID] }) imageIds: string[],
  ): Promise<ProductImageType[]> {
    const images = await this.productsService.reorderImages(productId, userId, imageIds);
    return images.map(mapImage);
  }

  @Mutation(() => ProductImageType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async setProductThumbnail(
    @CurrentUser('id') userId: string,
    @Args('productId') productId: string,
    @Args('imageId') imageId: string,
  ): Promise<ProductImageType> {
    const image = await this.productsService.setProductThumbnail(productId, imageId, userId);
    return mapImage(image);
  }
}
