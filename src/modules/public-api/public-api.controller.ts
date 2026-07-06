import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { ApiKeyAuth, ApiKeyAuthContext } from '../api-keys/decorators/api-key-auth.decorator';
import { ProductsService } from '../products/products.service';
import { CreatePublicProductDto } from './dto/create-public-product.dto';
import { mapProduct } from '../../graphql/models/mappers';
import { ProductType } from '../../graphql/models/types';

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
}
