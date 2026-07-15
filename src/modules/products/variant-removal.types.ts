import { registerEnumType } from '@nestjs/graphql';

export enum VariantRemovalBlockReason {
  HAS_ORDERS = 'HAS_ORDERS',
  HAS_OPEN_CARTS = 'HAS_OPEN_CARTS',
}

registerEnumType(VariantRemovalBlockReason, {
  name: 'VariantRemovalBlockReason',
});

export interface VariantRemovalBlockerFlags {
  hasOrders: boolean;
  hasOpenCarts: boolean;
}

export interface ProductVariantSyncImpactRemoved {
  id: string;
  sku: string;
  optionsJson: string | null;
  optionKey: string;
  reasons: VariantRemovalBlockReason[];
}

export interface ProductVariantSyncImpact {
  kept: number;
  new: number;
  removed: number;
  blocked: boolean;
  removedVariants: ProductVariantSyncImpactRemoved[];
}

export interface BlockedVariantPayload {
  id: string;
  sku: string;
  reasons: VariantRemovalBlockReason[];
}
