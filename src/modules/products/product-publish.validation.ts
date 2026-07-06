import { Product } from '../../database/entities/product.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';

export const PRODUCT_PUBLISH_CHECKLIST_KEYS = [
  'name',
  'media',
  'category',
  'variants',
  'price',
  'stock',
] as const;

export type ProductPublishChecklistKey = (typeof PRODUCT_PUBLISH_CHECKLIST_KEYS)[number];

export interface ProductPublishChecklistItem {
  key: ProductPublishChecklistKey;
  complete: boolean;
}

export interface ProductPublishChecklist {
  items: ProductPublishChecklistItem[];
  missingKeys: ProductPublishChecklistKey[];
  canPublish: boolean;
}

function effectiveVariantPrice(basePrice: number, variant: ProductVariant): number {
  return Number(basePrice) + Number(variant.priceAdjustment ?? 0);
}

export function getProductPublishChecklist(product: Product): ProductPublishChecklist {
  const variants = product.variants ?? [];
  const images = product.images ?? [];
  const hasName = Boolean(product.name?.trim());
  const hasMedia = images.length > 0;
  const hasCategory = Boolean(product.categoryId);
  const hasVariants = variants.length > 0;
  const basePrice = Number(product.basePrice ?? 0);
  const hasValidPrice =
    hasVariants &&
    variants.every((variant) => effectiveVariantPrice(basePrice, variant) >= 0) &&
    variants.some((variant) => effectiveVariantPrice(basePrice, variant) > 0);
  const hasStock = variants.some((variant) => Number(variant.stockQuantity ?? 0) > 0);

  const items: ProductPublishChecklistItem[] = [
    { key: 'name', complete: hasName },
    { key: 'media', complete: hasMedia },
    { key: 'category', complete: hasCategory },
    { key: 'variants', complete: hasVariants },
    { key: 'price', complete: hasValidPrice },
    { key: 'stock', complete: hasStock },
  ];

  const missingKeys = items.filter((item) => !item.complete).map((item) => item.key);

  return {
    items,
    missingKeys,
    canPublish: missingKeys.length === 0,
  };
}

export const PRODUCT_PUBLISH_CHECKLIST_LABELS: Record<ProductPublishChecklistKey, string> = {
  name: 'ชื่อสินค้า',
  media: 'รูปภาพสินค้า (อย่างน้อย 1 รูป)',
  category: 'หมวดหมู่',
  variants: 'ตัวเลือกสินค้า (อย่างน้อย 1 รายการ)',
  price: 'ราคา',
  stock: 'สต็อก',
};

export function formatPublishChecklistMessage(missingKeys: ProductPublishChecklistKey[]): string {
  if (missingKeys.length === 0) {
    return 'สินค้าพร้อมเผยแพร่';
  }

  const labels = missingKeys.map((key) => PRODUCT_PUBLISH_CHECKLIST_LABELS[key]);
  return `ไม่สามารถเผยแพร่ได้ ยังขาด: ${labels.join(', ')}`;
}
