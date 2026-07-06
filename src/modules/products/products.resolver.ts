import {
  Args,
  Field,
  Float,
  ID,
  InputType,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AnalyticsService } from '../analytics/analytics.service';
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
  name: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  basePrice: number;

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
  warning?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  expiryDate?: string;
}

@Resolver(() => ProductType)
export class ProductsResolver {
  constructor(
    private readonly productsService: ProductsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @ResolveField(() => Int)
  async soldCount(@Parent() product: ProductType): Promise<number> {
    return this.analyticsService.getProductSoldCount(product.id);
  }

  @Query(() => ProductConnection)
  @Public()
  async products(
    @Args('search', { nullable: true }) search?: string,
    @Args('storeId', { nullable: true }) storeId?: string,
    @Args('category', { nullable: true }) category?: string,
    @Args('tag', { nullable: true }) tag?: string,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<ProductConnection> {
    const result = await this.productsService.findAll({
      search,
      storeId,
      category,
      tag,
      status: ProductStatus.PUBLISHED,
      page,
      limit,
    });

    return {
      items: result.items.map(mapProduct),
      pagination: result.pagination,
    };
  }

  @Query(() => [ProductType])
  @Public()
  async recommendedProducts(
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
  ): Promise<ProductType[]> {
    const cappedLimit = Math.min(Math.max(limit ?? 50, 1), 50);
    const topProducts = await this.analyticsService.getPlatformTopProducts(cappedLimit);
    const productIds = topProducts.map((item) => item.productId);
    const products = await this.productsService.findPublishedByIds(productIds);

    // Backfill with recently published products when there is little or no sales
    // history, so the storefront always has products to recommend.
    if (products.length < cappedLimit) {
      const seenIds = new Set(products.map((product) => product.id));
      const { items: latestProducts } = await this.productsService.findAll({
        status: ProductStatus.PUBLISHED,
        page: 1,
        limit: cappedLimit,
      });
      for (const product of latestProducts) {
        if (products.length >= cappedLimit) {
          break;
        }
        if (!seenIds.has(product.id)) {
          products.push(product);
          seenIds.add(product.id);
        }
      }
    }

    return products.map(mapProduct);
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
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<ProductConnection> {
    const activeStoreId = await this.productsService.resolveActiveStoreId(userId, storeId);

    const result = await this.productsService.findAll({
      search,
      storeId: activeStoreId,
      category,
      allStatuses: true,
      page,
      limit,
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
