import { PublicApiController } from './public-api.controller';
import { ProductsService } from '../products/products.service';
import { ProductStatus } from '../../database/entities/product.entity';
import { CreatePublicProductDto } from './dto/create-public-product.dto';
import { UpdatePublicProductDto, UpdatePublicVariantDto } from './dto/update-public-product.dto';

describe('PublicApiController', () => {
  let controller: PublicApiController;
  let productsService: {
    createWithVariants: jest.Mock;
    updateProductForPublicApi: jest.Mock;
    updateVariantStockPriceForPublicApi: jest.Mock;
  };

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
    };
    controller = new PublicApiController(productsService as unknown as ProductsService);
  });

  it('delegates to createWithVariants with mapped payload and returns mapped product', async () => {
    const result = await controller.createProduct('store-1', dto, apiKeyAuth);

    expect(productsService.createWithVariants).toHaveBeenCalledWith('user-1', 'store-1', {
      name: dto.name,
      description: dto.description,
      warning: undefined,
      expiryDate: undefined,
      category: dto.category,
      tags: dto.tags,
      petType: undefined,
      brand: undefined,
      images: undefined,
      variants: [{ name: 'รสชาติ', values: ['ไก่', 'ปลา'] }],
      variantItems: [
        { sku: 'TEST-CHK-001', stock: 10, price: 499, options: { รสชาติ: 'ไก่' } },
        { sku: 'TEST-FISH-001', stock: 5, price: 519, options: { รสชาติ: 'ปลา' } },
      ],
    });
    expect(result.id).toBe('prod-1');
    expect(result.status).toBe(ProductStatus.DRAFT);
    expect(result.variants).toHaveLength(2);
    expect(result.variants?.[0].sku).toBe('TEST-CHK-001');
  });

  it('uses apiKeyAuth.createdBy as the acting user', async () => {
    await controller.createProduct('store-1', dto, {
      ...apiKeyAuth,
      createdBy: 'vendor-user-99',
    });

    expect(productsService.createWithVariants).toHaveBeenCalledWith(
      'vendor-user-99',
      'store-1',
      expect.any(Object),
    );
  });

  it('delegates product PATCH to updateProductForPublicApi', async () => {
    const patch: UpdatePublicProductDto = {
      name: 'Updated',
      description: 'New desc',
      category: 'อาหารแมว',
    };

    const result = await controller.updateProduct('store-1', 'prod-1', patch, apiKeyAuth);

    expect(productsService.updateProductForPublicApi).toHaveBeenCalledWith(
      'prod-1',
      'store-1',
      'user-1',
      {
        name: 'Updated',
        description: 'New desc',
        warning: undefined,
        expiryDate: undefined,
        category: 'อาหารแมว',
        tags: undefined,
        petType: undefined,
        brand: undefined,
        images: undefined,
      },
    );
    expect(result.name).toBe('Updated');
  });

  it('delegates variant PATCH by id', async () => {
    const patch: UpdatePublicVariantDto = { stock: 20, price: 549 };
    const result = await controller.updateVariantById(
      'store-1',
      'prod-1',
      'var-1',
      patch,
      apiKeyAuth,
    );

    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenCalledWith(
      'store-1',
      'user-1',
      {
        variantId: 'var-1',
        productId: 'prod-1',
        stock: 20,
        price: 549,
      },
    );
    expect(result.stockQuantity).toBe(20);
    expect(result.price).toBe(549);
  });

  it('delegates variant PATCH by sku', async () => {
    const patch: UpdatePublicVariantDto = { stock: 3 };
    await controller.updateVariantBySku('store-1', 'TEST-CHK-001', patch, apiKeyAuth);

    expect(productsService.updateVariantStockPriceForPublicApi).toHaveBeenCalledWith(
      'store-1',
      'user-1',
      {
        sku: 'TEST-CHK-001',
        stock: 3,
        price: undefined,
      },
    );
  });
});
