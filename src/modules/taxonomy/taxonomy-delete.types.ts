export type TaxonomyKind = 'category' | 'tag' | 'pet_type' | 'brand';

export interface TaxonomyDeleteImpactProductSummary {
  id: string;
  name: string;
  slug: string;
}

export interface TaxonomyDeleteImpact {
  productCount: number;
  products: TaxonomyDeleteImpactProductSummary[];
}

export interface DeleteTaxonomyResult {
  success: boolean;
  deletedId: string;
  deletedCategoryId?: string | null;
  detachedProductCount: number;
  reassignedProductCount?: number;
  replacementCategoryId?: string | null;
  notifiedStoreCount: number;
}
