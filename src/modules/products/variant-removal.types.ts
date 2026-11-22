import { registerEnumType } from '@nestjs/graphql';

export enum VariantRemovalBlockReason {
  HAS_ORDERS = 'HAS_ORDERS',
  HAS_OPEN_CARTS = 'HAS_OPEN_CARTS',
}

registerEnumType(VariantRemovalBlockReason, {
  name: 'VariantRemovalBlockReason',
});

/** What sync/remove will do for a SKU leaving the active matrix. */
export enum VariantRemovalDisposition {
  DELETE = 'DELETE',
  CLEAR_CART_AND_DELETE = 'CLEAR_CART_AND_DELETE',
  RETIRE = 'RETIRE',
}

registerEnumType(VariantRemovalDisposition, {
  name: 'VariantRemovalDisposition',
});

export interface VariantRemovalBlockerFlags {
  hasOrders: boolean;
  hasOpenCarts: boolean;
  openCartCount: number;
}

export interface ProductVariantSyncImpactRemoved {
  id: string;
  sku: string;
  optionsJson: string | null;
  optionKey: string;
  /** Legacy reason codes (informational); no longer hard-blocks save. */
  reasons: VariantRemovalBlockReason[];
  disposition: VariantRemovalDisposition;
  openCartCount: number;
}

export interface ProductVariantSyncImpact {
  kept: number;
  new: number;
  removed: number;
  /** Always false under retire-and-clear-carts policy; kept for GraphQL compat. */
  blocked: boolean;
  removedVariants: ProductVariantSyncImpactRemoved[];
}

export interface BlockedVariantPayload {
  id: string;
  sku: string;
  reasons: VariantRemovalBlockReason[];
}
