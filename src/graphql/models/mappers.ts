import { Product } from '../../database/entities/product.entity';
import { Customer } from '../../database/entities/customer.entity';
import { User } from '../../database/entities/user.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { ProductVariant } from '../../database/entities/product-variant.entity';
import { Store } from '../../database/entities/store.entity';
import { Category } from '../../database/entities/category.entity';
import { Tag } from '../../database/entities/tag.entity';
import { PetType } from '../../database/entities/pet-type.entity';
import { Brand } from '../../database/entities/brand.entity';
import { Promotion } from '../../database/entities/promotion.entity';
import { StoreRequest } from '../../database/entities/store-request.entity';
import { StoreReactivationRequest } from '../../database/entities/store-reactivation-request.entity';
import { ShippingProvider } from '../../database/entities/shipping-provider.entity';
import { StoreShippingOption } from '../../database/entities/store-shipping-option.entity';
import {
  ProductType,
  ProductVariantType,
  StoreType,
  ProductImageType,
  CategoryType,
  TagType,
  PetTypeType,
  BrandType,
  PromotionType,
  StoreRequestType,
  StoreReactivationRequestType,
  AdminStoreType,
  ShippingProviderType,
  StoreShippingOptionType,
  CustomerProfile,
  UserProfile,
} from './types';

export function mapCustomerProfile(
  customer: Pick<
    Customer,
    'id' | 'phone' | 'fullName' | 'email' | 'profilePhotoUrl' | 'dateOfBirth'
  >,
): CustomerProfile {
  return {
    id: customer.id,
    phone: customer.phone,
    fullName: customer.fullName,
    email: customer.email,
    profilePhotoUrl: customer.profilePhotoUrl,
    dateOfBirth: customer.dateOfBirth,
  };
}

export function mapUserProfile(
  user: Pick<User, 'id' | 'email' | 'fullName' | 'role' | 'profilePhotoUrl' | 'emailVerified'>,
  storeId?: string | null,
): UserProfile {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    storeId: storeId ?? null,
    profilePhotoUrl: user.profilePhotoUrl,
    emailVerified: user.emailVerified ?? false,
  };
}

export function mapPromotion(promotion: Promotion): PromotionType {
  return {
    id: promotion.id,
    storeId: promotion.storeId,
    code: promotion.code,
    name: promotion.name,
    description: promotion.description,
    type: promotion.type,
    scope: promotion.scope,
    discountValue: Number(promotion.discountValue),
    minPurchaseAmount: promotion.minPurchaseAmount ? Number(promotion.minPurchaseAmount) : null,
    maxDiscountAmount: promotion.maxDiscountAmount ? Number(promotion.maxDiscountAmount) : null,
    usageLimit: promotion.usageLimit,
    usagePerCustomer: promotion.usagePerCustomer,
    usageCount: promotion.usageCount,
    isActive: promotion.isActive,
    autoApply: promotion.autoApply,
    priority: promotion.priority,
    conditions:
      promotion.conditions && Object.keys(promotion.conditions).length > 0
        ? JSON.stringify(promotion.conditions)
        : null,
    startsAt: promotion.startsAt,
    expiresAt: promotion.expiresAt,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  };
}

export function mapStoreRequest(request: StoreRequest): StoreRequestType {
  return {
    id: request.id,
    vendorUserId: request.vendorUserId,
    storeName: request.storeName,
    description: request.description,
    contactPhone: request.contactPhone,
    contactEmail: request.contactEmail,
    address:
      request.address && Object.keys(request.address).length > 0
        ? JSON.stringify(request.address)
        : null,
    logoUrl: request.logoUrl,
    status: request.status,
    rejectionReason: request.rejectionReason,
    createdStoreId: request.createdStoreId,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function mapStoreReactivationRequest(
  request: StoreReactivationRequest,
): StoreReactivationRequestType {
  return {
    id: request.id,
    storeId: request.storeId,
    storeName: request.store?.name ?? '',
    submittedByUserId: request.submittedByUserId,
    submittedByFullName: request.submittedBy?.fullName ?? null,
    submittedByEmail: request.submittedBy?.email ?? null,
    title: request.title,
    content: request.content,
    status: request.status,
    reviewNote: request.reviewNote,
    images: (request.images ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({
        id: image.id,
        imageUrl: image.imageUrl,
        sortOrder: image.sortOrder,
      })),
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    reviewedAt: request.reviewedAt,
  };
}

export function mapAdminStore(store: Store): AdminStoreType {
  return {
    id: store.id,
    ownerId: store.ownerId,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logoUrl: store.logoUrl,
    bannerUrl: store.bannerUrl,
    status: store.status,
    contactPhone: store.contactPhone,
    contactEmail: store.contactEmail,
    address: store.address,
    bankAccountName: store.bankAccountName,
    bankAccountNumber: store.bankAccountNumber,
    bankName: store.bankName,
    payoutSchedule: store.payoutSchedule,
    payoutSchedulePaused: store.payoutSchedulePaused,
    ownerEmail: store.owner?.email ?? null,
    ownerFullName: store.owner?.fullName ?? null,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

export function mapStore(store: Store): StoreType {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description,
    logoUrl: store.logoUrl,
    bannerUrl: store.bannerUrl,
    status: store.status,
  };
}

export function mapImage(image: ProductImage): ProductImageType {
  return {
    id: image.id,
    imageUrl: image.url,
    sortOrder: image.sortOrder,
    isThumbnail: image.isThumbnail ?? false,
  };
}

function resolveThumbnailUrl(images?: ProductImage[]): string | null {
  if (!images?.length) {
    return null;
  }

  const sorted = [...images].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
  const thumbnail = sorted.find((img) => img.isThumbnail) ?? sorted[0];
  return thumbnail?.url ?? null;
}

function formatExpiryDate(expiryDate: string | Date | null | undefined): string | null {
  if (!expiryDate) {
    return null;
  }

  if (expiryDate instanceof Date) {
    return expiryDate.toISOString().slice(0, 10);
  }

  return String(expiryDate).slice(0, 10);
}

export function mapVariant(variant: ProductVariant, basePrice = 0): ProductVariantType {
  const mapped: ProductVariantType = {
    id: variant.id,
    sku: variant.sku,
    price: Number(basePrice) + Number(variant.priceAdjustment ?? 0),
    stockQuantity: variant.stockQuantity,
    optionsJson: variant.options ? JSON.stringify(variant.options) : null,
  };

  if (variant.product) {
    mapped.product = mapCartProduct(variant.product);
  }

  return mapped;
}

function mapCartProduct(product: Product): ProductType {
  const basePrice = Number(product.basePrice);

  return {
    id: product.id,
    storeId: product.storeId,
    name: product.name,
    slug: product.slug,
    description: product.description ?? null,
    basePrice,
    compareAtPrice: product.compareAtPrice != null ? Number(product.compareAtPrice) : null,
    status: product.status,
    category: product.category ?? product.categoryRelation?.name ?? null,
    categoryId: product.categoryId ?? product.categoryRelation?.id ?? null,
    tags: product.tags ?? [],
    tagIds: null,
    averageRating: Number(product.averageRating ?? 0),
    reviewCount: product.reviewCount ?? 0,
    warning: product.warning ?? null,
    expiryDate: formatExpiryDate(product.expiryDate),
    thumbnailUrl: resolveThumbnailUrl(product.images),
    store: product.store ? mapStore(product.store) : null,
  };
}

export function mapCategory(category: Category): CategoryType {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    approvalStatus: category.approvalStatus,
    createdBy: category.createdBy,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    imageUrl: category.imageUrl ?? null,
  };
}

export function mapTag(tag: Tag): TagType {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    approvalStatus: tag.approvalStatus,
    createdBy: tag.createdBy,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

export function mapPetType(petType: PetType): PetTypeType {
  return {
    id: petType.id,
    name: petType.name,
    slug: petType.slug,
    approvalStatus: petType.approvalStatus,
    createdBy: petType.createdBy,
    createdAt: petType.createdAt,
    updatedAt: petType.updatedAt,
    imageUrl: petType.imageUrl ?? null,
  };
}

export function mapBrand(brand: Brand): BrandType {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    approvalStatus: brand.approvalStatus,
    createdBy: brand.createdBy,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  };
}

export function mapProduct(product: Product): ProductType {
  const basePrice = Number(product.basePrice);
  const category = product.category ?? product.categoryRelation?.name ?? null;
  const tags = product.taxonomyTags?.length
    ? product.taxonomyTags.map((tag) => tag.name)
    : (product.tags ?? []);
  const tagIds = product.taxonomyTags?.length ? product.taxonomyTags.map((tag) => tag.id) : null;

  return {
    id: product.id,
    storeId: product.storeId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    basePrice,
    compareAtPrice: product.compareAtPrice != null ? Number(product.compareAtPrice) : null,
    status: product.status,
    category,
    categoryId: product.categoryId ?? product.categoryRelation?.id ?? null,
    petTypeId: product.petTypeId ?? product.petTypeRelation?.id ?? null,
    brandId: product.brandId ?? product.brandRelation?.id ?? null,
    tags,
    tagIds,
    averageRating: Number(product.averageRating),
    reviewCount: product.reviewCount,
    warning: product.warning ?? null,
    expiryDate: formatExpiryDate(product.expiryDate),
    thumbnailUrl: resolveThumbnailUrl(product.images),
    store: product.store ? mapStore(product.store) : null,
    images: product.images
      ? [...product.images]
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
              a.id.localeCompare(b.id),
          )
          .map(mapImage)
      : undefined,
    variants: product.variants?.map((variant) => mapVariant(variant, basePrice)),
  };
}

export function mapShippingProvider(provider: ShippingProvider): ShippingProviderType {
  return {
    id: provider.id,
    name: provider.name,
    isActive: provider.isActive,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function mapStoreShippingOption(option: StoreShippingOption): StoreShippingOptionType {
  return {
    id: option.id,
    storeId: option.storeId,
    name: option.name,
    description: option.description,
    price: Number(option.price),
    sortOrder: option.sortOrder,
    isActive: option.isActive,
    providerId: option.providerId ?? null,
  };
}
