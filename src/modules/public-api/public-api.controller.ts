import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { ApiKeyAuth, ApiKeyAuthContext } from '../api-keys/decorators/api-key-auth.decorator';
import { ProductsService } from '../products/products.service';
import { CreatePublicProductDto } from './dto/create-public-product.dto';
import { UpdatePublicProductDto, UpdatePublicVariantDto } from './dto/update-public-product.dto';
import { mapProduct, mapVariant } from '../../graphql/models/mappers';
import { ProductType, ProductVariantType } from '../../graphql/models/types';

@Controller('api/v1/stores/:storeId')
@Public()
export class PublicApiController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('products')
  @UseGuards(ApiKeyGuard)
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
  @UseGuards(ApiKeyGuard)
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
      },
    );
    return mapProduct(product);
  }

  @Patch('products/:productId/variants/:variantId')
  @UseGuards(ApiKeyGuard)
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
  @UseGuards(ApiKeyGuard)
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
}
