import { PublicApiController } from './public-api.controller';
import { ProductsService } from '../products/products.service';
import { ProductStatus } from '../../database/entities/product.entity';
import { CreatePublicProductDto } from './dto/create-public-product.dto';

describe('PublicApiController', () => {
  let controller: PublicApiController;
  let productsService: { createWithVariants: jest.Mock };

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
        priceModifier: 0,
        options: { รสชาติ: 'ไก่' },
      },
      {
        id: 'var-2',
        sku: 'TEST-FISH-001',
        stockQuantity: 5,
        priceModifier: 20,
        options: { รสชาติ: 'ปลา' },
      },
    ],
  };

  beforeEach(() => {
    productsService = {
      createWithVariants: jest.fn().mockResolvedValue(createdProduct),
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
});
