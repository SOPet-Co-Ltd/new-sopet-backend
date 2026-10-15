import { TaxonomyApprovalStatus } from '../../database/entities/enums/taxonomy.enums';
import { ProductStatus } from '../../database/entities/product.entity';
import { mapProduct } from './mappers';

describe('mapProduct brandName', () => {
  const baseProduct = {
    id: 'prod-1',
    storeId: 'store-1',
    name: 'NexGard Spectra',
    slug: 'nexgard-spectra',
    description: null,
    basePrice: 465,
    compareAtPrice: null,
    status: ProductStatus.PUBLISHED,
    category: null,
    categoryId: null,
    categoryRelation: null,
    petTypeId: null,
    petTypeRelation: null,
    brandId: 'brand-1',
    tags: [],
    taxonomyTags: [],
    averageRating: 5,
    reviewCount: 22,
    warning: null,
    expiryDate: null,
    images: [],
    variants: [],
    store: null,
  };

  it('maps approved brandRelation.name to brandName', () => {
    const mapped = mapProduct({
      ...baseProduct,
      brandRelation: {
        id: 'brand-1',
        name: 'NexGard',
        slug: 'nexgard',
        approvalStatus: TaxonomyApprovalStatus.APPROVED,
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    expect(mapped.brandId).toBe('brand-1');
    expect(mapped.brandName).toBe('NexGard');
  });

  it('omits brandName when brand is not approved', () => {
    const mapped = mapProduct({
      ...baseProduct,
      brandRelation: {
        id: 'brand-1',
        name: 'NexGard',
        slug: 'nexgard',
        approvalStatus: TaxonomyApprovalStatus.PENDING,
        createdBy: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    expect(mapped.brandName).toBeNull();
  });

  it('omits brandName when brandRelation is missing', () => {
    const mapped = mapProduct({
      ...baseProduct,
      brandRelation: null,
    } as never);

    expect(mapped.brandName).toBeNull();
  });
});
