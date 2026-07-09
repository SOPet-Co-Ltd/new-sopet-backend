import { getProductPublishChecklist } from './product-publish.validation';
import { ProductStatus } from '../../database/entities/product.entity';

function buildProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    name: 'Dog Food',
    basePrice: 299,
    status: ProductStatus.DRAFT,
    categoryId: 'cat-1',
    petTypeId: 'pet-1',
    images: [{ id: 'img-1', url: 'https://example.com/a.jpg' }],
    variants: [
      {
        id: 'var-1',
        sku: 'SKU-1',
        stockQuantity: 10,
        priceAdjustment: 0,
      },
    ],
    ...overrides,
  } as never;
}

describe('getProductPublishChecklist', () => {
  it('returns complete checklist for a sellable product', () => {
    const checklist = getProductPublishChecklist(buildProduct());
    expect(checklist.canPublish).toBe(true);
    expect(checklist.missingKeys).toEqual([]);
  });

  it('flags missing media, category, variants, price, and stock', () => {
    const checklist = getProductPublishChecklist(
      buildProduct({
        name: '  ',
        categoryId: null,
        petTypeId: null,
        images: [],
        variants: [],
        basePrice: 0,
      }),
    );

    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingKeys).toEqual(
      expect.arrayContaining([
        'name',
        'media',
        'category',
        'petType',
        'variants',
        'price',
        'stock',
      ]),
    );
  });

  it('requires at least one variant with positive stock', () => {
    const checklist = getProductPublishChecklist(
      buildProduct({
        variants: [
          {
            id: 'var-1',
            sku: 'SKU-1',
            stockQuantity: 0,
            priceAdjustment: 0,
          },
        ],
      }),
    );

    expect(checklist.canPublish).toBe(false);
    expect(checklist.missingKeys).toContain('stock');
  });
});
