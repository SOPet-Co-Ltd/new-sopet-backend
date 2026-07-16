import { Field, Float, Int, ObjectType } from '@nestjs/graphql';
import { VariantRemovalBlockReason } from '../../modules/products/variant-removal.types';

@ObjectType()
export class PaginationMeta {
  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  totalPages!: number;
}

@ObjectType()
export class AuthTokens {
  @Field()
  accessToken!: string;

  @Field()
  refreshToken!: string;
}

@ObjectType()
export class CustomerProfile {
  @Field()
  id!: string;

  @Field()
  phone!: string;

  @Field(() => String, { nullable: true })
  fullName?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  profilePhotoUrl?: string | null;

  @Field(() => String, { nullable: true })
  dateOfBirth?: string | null;
}

@ObjectType()
export class UserProfile {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field()
  fullName!: string;

  @Field()
  role!: string;

  @Field(() => String, { nullable: true })
  storeId?: string | null;

  @Field(() => String, { nullable: true })
  profilePhotoUrl?: string | null;

  @Field(() => Boolean, { defaultValue: false })
  emailVerified!: boolean;
}

@ObjectType()
export class MeResult {
  @Field(() => CustomerProfile, { nullable: true })
  customer?: CustomerProfile | null;

  @Field(() => UserProfile, { nullable: true })
  user?: UserProfile | null;
}

@ObjectType()
export class CustomerAuthPayload {
  @Field(() => AuthTokens, { nullable: true })
  tokens?: AuthTokens | null;

  @Field(() => CustomerProfile, { nullable: true })
  customer?: CustomerProfile | null;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  pendingDeletion?: boolean;

  @Field(() => String, { nullable: true })
  reactivationToken?: string | null;
}

@ObjectType()
export class VendorAuthPayload {
  @Field(() => AuthTokens)
  tokens!: AuthTokens;

  @Field(() => UserProfile)
  user!: UserProfile;
}

@ObjectType()
export class MessagePayload {
  @Field()
  message!: string;
}

@ObjectType()
export class StoreType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field(() => String, { nullable: true })
  bannerUrl?: string | null;

  @Field()
  status!: string;
}

@ObjectType()
export class VendorStoreType {
  @Field(() => StoreType)
  store!: StoreType;

  @Field()
  membershipRole!: string;
}

@ObjectType()
export class ProductImageType {
  @Field()
  id!: string;

  @Field()
  imageUrl!: string;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  isThumbnail!: boolean;
}

@ObjectType()
export class ProductVariantType {
  @Field()
  id!: string;

  @Field()
  sku!: string;

  @Field(() => Float)
  price!: number;

  @Field(() => Int)
  stockQuantity!: number;

  @Field(() => String, { nullable: true })
  optionsJson?: string | null;

  @Field(() => ProductType, { nullable: true })
  product?: ProductType | null;
}

@ObjectType()
export class ProductType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Float)
  basePrice!: number;

  @Field(() => Float, { nullable: true })
  compareAtPrice?: number | null;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  category?: string | null;

  @Field(() => String, { nullable: true })
  categoryId?: string | null;

  @Field(() => String, { nullable: true })
  petTypeId?: string | null;

  @Field(() => String, { nullable: true })
  brandId?: string | null;

  @Field(() => [String])
  tags!: string[];

  @Field(() => [String], { nullable: true })
  tagIds?: string[] | null;

  @Field(() => Float)
  averageRating!: number;

  @Field(() => Int)
  reviewCount!: number;

  @Field(() => String, { nullable: true })
  warning?: string | null;

  @Field(() => String, { nullable: true })
  expiryDate?: string | null;

  @Field(() => String, { nullable: true })
  thumbnailUrl?: string | null;

  @Field(() => StoreType, { nullable: true })
  store?: StoreType | null;

  @Field(() => [ProductImageType], { nullable: true })
  images?: ProductImageType[];

  @Field(() => [ProductVariantType], { nullable: true })
  variants?: ProductVariantType[];
}

@ObjectType()
export class ProductConnection {
  @Field(() => [ProductType])
  items!: ProductType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class ProductPublishChecklistItemType {
  @Field()
  key!: string;

  @Field()
  complete!: boolean;
}

@ObjectType()
export class ProductPublishChecklistType {
  @Field()
  canPublish!: boolean;

  @Field(() => [ProductPublishChecklistItemType])
  items!: ProductPublishChecklistItemType[];

  @Field(() => [String])
  missingKeys!: string[];
}

@ObjectType()
export class CartItemType {
  @Field()
  id!: string;

  @Field()
  variantId!: string;

  @Field(() => Int)
  quantity!: number;

  @Field(() => ProductVariantType, { nullable: true })
  productVariant?: ProductVariantType | null;
}

@ObjectType()
export class CartType {
  @Field()
  id!: string;

  @Field(() => String, { nullable: true })
  customerId?: string | null;

  @Field(() => String, { nullable: true })
  sessionId?: string | null;

  @Field(() => [CartItemType])
  items!: CartItemType[];
}

@ObjectType()
export class SavedAddressType {
  @Field()
  id!: string;

  @Field(() => String, { nullable: true })
  label?: string | null;

  @Field()
  fullName!: string;

  @Field()
  phone!: string;

  @Field()
  addressLine1!: string;

  @Field(() => String, { nullable: true })
  addressLine2?: string | null;

  @Field(() => String, { nullable: true })
  tumbon?: string | null;

  @Field()
  amphoe!: string;

  @Field()
  province!: string;

  @Field()
  postalCode!: string;

  @Field()
  isDefault!: boolean;
}

@ObjectType()
export class OrderShippingAddressType {
  @Field()
  fullName!: string;

  @Field()
  phone!: string;

  @Field()
  addressLine1!: string;

  @Field(() => String, { nullable: true })
  addressLine2?: string | null;

  @Field(() => String, { nullable: true })
  tumbon?: string | null;

  @Field()
  amphoe!: string;

  @Field()
  province!: string;

  @Field()
  postalCode!: string;
}

@ObjectType()
export class OrderStoreShippingType {
  @Field()
  storeId!: string;

  @Field()
  optionName!: string;

  @Field(() => Float)
  shippingFee!: number;
}

@ObjectType()
export class OrderItemType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  variantId!: string;

  @Field()
  productName!: string;

  @Field(() => String, { nullable: true })
  productId?: string | null;

  @Field(() => String, { nullable: true })
  productImageUrl?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'JSON string of snapshot variant options from order create (e.g. {"ขนาด":"1kg"})',
  })
  variantOptions?: string | null;

  @Field(() => Float)
  unitPrice!: number;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Float)
  subtotal!: number;

  @Field()
  fulfillmentStatus!: string;

  @Field(() => String, { nullable: true })
  trackingNumber?: string | null;

  @Field(() => String, { nullable: true })
  fulfillmentProvider?: string | null;

  @Field(() => String, { nullable: true })
  trackingUrl?: string | null;
}

@ObjectType()
export class OrderType {
  @Field()
  id!: string;

  @Field()
  orderNumber!: string;

  @Field()
  status!: string;

  @Field(() => Float)
  subtotal!: number;

  @Field(() => Float)
  shippingFee!: number;

  @Field(() => Float)
  discountAmount!: number;

  @Field(() => Float)
  total!: number;

  @Field()
  paymentMethod!: string;

  @Field(() => String, { nullable: true })
  guestPhone?: string | null;

  @Field(() => String, { nullable: true })
  guestName?: string | null;

  @Field(() => String, { nullable: true })
  guestEmail?: string | null;

  @Field(() => [OrderItemType])
  items!: OrderItemType[];

  @Field()
  createdAt!: Date;

  @Field(() => [OrderStoreShippingType])
  storeShippings!: OrderStoreShippingType[];

  @Field(() => OrderShippingAddressType, { nullable: true })
  shippingAddress?: OrderShippingAddressType | null;
}

@ObjectType()
export class OrderTrackingStoreShippingType {
  @Field()
  storeId!: string;

  @Field()
  optionName!: string;

  @Field(() => Float)
  shippingFee!: number;
}

@ObjectType()
export class OrderTrackingItemType {
  @Field()
  storeId!: string;

  @Field(() => String, { nullable: true })
  productId?: string | null;

  @Field()
  productName!: string;

  @Field(() => String, { nullable: true })
  productImageUrl?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'JSON string of snapshot variant options from order create (e.g. {"ขนาด":"1kg"})',
  })
  variantOptions?: string | null;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Float)
  unitPrice!: number;

  @Field(() => Float)
  subtotal!: number;

  @Field()
  fulfillmentStatus!: string;

  @Field(() => String, { nullable: true })
  trackingNumber?: string | null;

  @Field(() => String, { nullable: true })
  fulfillmentProvider?: string | null;

  @Field(() => String, { nullable: true })
  trackingUrl?: string | null;
}

@ObjectType()
export class OrderTrackingType {
  @Field()
  orderNumber!: string;

  @Field()
  status!: string;

  @Field()
  createdAt!: Date;

  @Field(() => Float)
  subtotal!: number;

  @Field(() => Float)
  shippingFee!: number;

  @Field(() => Float)
  discountAmount!: number;

  @Field(() => Float)
  total!: number;

  @Field(() => [OrderTrackingItemType])
  items!: OrderTrackingItemType[];

  @Field(() => [OrderTrackingStoreShippingType])
  storeShippings!: OrderTrackingStoreShippingType[];
}

@ObjectType()
export class OrderConnection {
  @Field(() => [OrderType])
  items!: OrderType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class PaymentType {
  @Field()
  id!: string;

  @Field()
  orderId!: string;

  @Field(() => Float)
  amount!: number;

  @Field()
  currency!: string;

  @Field()
  status!: string;

  @Field()
  paymentMethod!: string;

  @Field(() => String, { nullable: true })
  authorizeUri?: string | null;

  @Field(() => String, { nullable: true })
  qrCodeUrl?: string | null;

  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;
}

@ObjectType()
export class FavoriteType {
  @Field()
  id!: string;

  @Field()
  productId!: string;

  @Field(() => ProductType, { nullable: true })
  product?: ProductType | null;
}

@ObjectType()
export class StoreMemberType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  userId!: string;

  @Field()
  role!: string;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  fullName?: string | null;
}

@ObjectType()
export class StoreMemberInvitationType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  email!: string;

  @Field()
  role!: string;

  @Field()
  status!: string;

  @Field()
  expiresAt!: string;
}

@ObjectType()
export class StoreInvitationPreviewType {
  @Field()
  storeName!: string;

  @Field()
  email!: string;

  @Field()
  role!: string;

  @Field()
  expiresAt!: string;

  @Field()
  userExists!: boolean;
}

@ObjectType()
export class ShippingProviderType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  isActive!: boolean;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class StoreShippingOptionType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Float)
  price!: number;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  isActive!: boolean;

  @Field(() => String, { nullable: true })
  providerId?: string | null;
}

@ObjectType()
export class PlatformBannerType {
  @Field()
  id!: string;

  @Field()
  title!: string;

  @Field()
  imageUrl!: string;

  @Field(() => String, { nullable: true })
  mobileImageUrl?: string | null;

  @Field(() => String, { nullable: true })
  linkUrl?: string | null;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  isActive!: boolean;

  @Field(() => Date, { nullable: true })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;
}

@ObjectType()
export class PlatformSponsorType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  imageUrl!: string;

  @Field(() => String, { nullable: true })
  linkUrl?: string | null;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  isActive!: boolean;

  @Field(() => Date, { nullable: true })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;
}

@ObjectType()
export class PlatformAdType {
  @Field()
  id!: string;

  @Field()
  title!: string;

  @Field()
  imageUrl!: string;

  @Field(() => String, { nullable: true })
  linkUrl?: string | null;

  @Field(() => Int)
  sortOrder!: number;

  @Field()
  isActive!: boolean;

  @Field(() => Date, { nullable: true })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;
}

@ObjectType()
export class PlatformSettingsType {
  @Field()
  storefrontUrl!: string;

  @Field()
  currency!: string;

  @Field()
  supportEmail!: string;
}

@ObjectType()
export class NotificationType {
  @Field()
  id!: string;

  @Field()
  type!: string;

  @Field({ nullable: true })
  title!: string;

  @Field()
  message!: string;

  @Field(() => String, { nullable: true })
  metadata!: string;

  @Field()
  isRead!: boolean;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class UploadResultType {
  @Field()
  url!: string;

  @Field()
  key!: string;
}

@ObjectType()
export class StoreAnalyticsType {
  @Field(() => Int)
  totalOrders!: number;

  @Field(() => Float)
  totalRevenue!: number;

  @Field(() => Int)
  totalProducts!: number;

  @Field(() => Int)
  pendingOrders!: number;

  @Field(() => Int)
  recentOrders!: number;
}

@ObjectType()
export class PlatformAnalyticsType {
  @Field(() => Int)
  totalOrders!: number;

  @Field(() => Float)
  totalRevenue!: number;

  @Field(() => Float)
  averageOrderValue!: number;

  @Field(() => Int)
  totalStores!: number;

  @Field(() => Int)
  pendingStores!: number;

  @Field(() => Int)
  totalCustomers!: number;
}

@ObjectType()
export class SalesTimePointType {
  @Field()
  date!: string;

  @Field(() => Float)
  revenue!: number;

  @Field(() => Int)
  orderCount!: number;
}

@ObjectType()
export class SalesBreakdownItemType {
  @Field()
  label!: string;

  @Field(() => Float)
  revenue!: number;

  @Field(() => Int)
  orderCount!: number;
}

@ObjectType()
export class TopStoreType {
  @Field()
  storeId!: string;

  @Field()
  storeName!: string;

  @Field(() => Float)
  revenue!: number;

  @Field(() => Int)
  orderCount!: number;
}

@ObjectType()
export class SavedPaymentMethodType {
  @Field()
  id!: string;

  @Field()
  type!: string;

  @Field()
  lastFour!: string;

  @Field()
  brand!: string;

  @Field(() => Int)
  expiryMonth!: number;

  @Field(() => Int)
  expiryYear!: number;

  @Field()
  isDefault!: boolean;
}

@ObjectType()
export class CategoryType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  approvalStatus!: string;

  @Field()
  createdBy!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;
}

@ObjectType()
export class TagType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  approvalStatus!: string;

  @Field()
  createdBy!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class PetTypeType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  approvalStatus!: string;

  @Field()
  createdBy!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;
}

@ObjectType()
export class BrandType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  approvalStatus!: string;

  @Field()
  createdBy!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class ProductVariantSyncImpactRemovedType {
  @Field()
  id!: string;

  @Field()
  sku!: string;

  @Field(() => String, { nullable: true })
  optionsJson?: string | null;

  @Field()
  optionKey!: string;

  @Field(() => [VariantRemovalBlockReason])
  reasons!: VariantRemovalBlockReason[];
}

@ObjectType()
export class ProductVariantSyncImpactType {
  @Field(() => Int)
  kept!: number;

  @Field(() => Int)
  new!: number;

  @Field(() => Int)
  removed!: number;

  @Field()
  blocked!: boolean;

  @Field(() => [ProductVariantSyncImpactRemovedType])
  removedVariants!: ProductVariantSyncImpactRemovedType[];
}

@ObjectType()
export class TaxonomyDeleteImpactProductType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;
}

@ObjectType()
export class TaxonomyDeleteImpactType {
  @Field(() => Int)
  productCount!: number;

  @Field(() => [TaxonomyDeleteImpactProductType])
  products!: TaxonomyDeleteImpactProductType[];
}

@ObjectType()
export class DeleteTaxonomyResultType {
  @Field()
  success!: boolean;

  @Field()
  deletedId!: string;

  @Field(() => String, { nullable: true })
  deletedCategoryId?: string | null;

  @Field(() => Int)
  detachedProductCount!: number;

  @Field(() => Int, { nullable: true })
  reassignedProductCount?: number;

  @Field(() => String, { nullable: true })
  replacementCategoryId?: string | null;

  @Field(() => Int)
  notifiedStoreCount!: number;
}

@ObjectType()
export class PromotionType {
  @Field()
  id!: string;

  @Field(() => String, { nullable: true })
  storeId?: string | null;

  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field()
  type!: string;

  @Field()
  scope!: string;

  @Field(() => Float)
  discountValue!: number;

  @Field(() => Float, { nullable: true })
  minPurchaseAmount?: number | null;

  @Field(() => Float, { nullable: true })
  maxDiscountAmount?: number | null;

  @Field(() => Int, { nullable: true })
  usageLimit?: number | null;

  @Field(() => Int)
  usagePerCustomer!: number;

  @Field(() => Int)
  usageCount!: number;

  @Field()
  isActive!: boolean;

  @Field()
  autoApply!: boolean;

  @Field(() => Int)
  priority!: number;

  @Field(() => String, { nullable: true })
  conditions?: string | null;

  @Field(() => Date, { nullable: true })
  startsAt?: Date | null;

  @Field(() => Date, { nullable: true })
  expiresAt?: Date | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class PromotionValidationResult {
  @Field()
  code!: string;

  @Field()
  name!: string;

  @Field(() => Float)
  discountAmount!: number;

  @Field(() => String, { nullable: true })
  ineligibilityReason?: string | null;

  @Field(() => Int, { nullable: true })
  freeUnits?: number | null;
}

/** Decision 6 — per-promotion soft eligibility item for batch validatePromotions. */
@ObjectType()
export class PromotionEligibilityResult {
  @Field(() => String, { nullable: true })
  id?: string | null;

  @Field()
  code!: string;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => Boolean)
  eligible!: boolean;

  @Field(() => String, { nullable: true })
  ineligibilityReason?: string | null;

  @Field(() => Float, { nullable: true })
  discountAmount?: number | null;

  @Field(() => Int, { nullable: true })
  freeUnits?: number | null;
}

@ObjectType()
export class ValidatePromotionsResult {
  @Field(() => [PromotionEligibilityResult])
  items!: PromotionEligibilityResult[];
}

@ObjectType()
export class StoreRequestType {
  @Field()
  id!: string;

  @Field()
  vendorUserId!: string;

  @Field()
  storeName!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  contactPhone?: string | null;

  @Field(() => String, { nullable: true })
  contactEmail?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  rejectionReason?: string | null;

  @Field(() => String, { nullable: true })
  createdStoreId?: string | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class StoreReactivationRequestImageType {
  @Field()
  id!: string;

  @Field()
  imageUrl!: string;

  @Field(() => Int)
  sortOrder!: number;
}

@ObjectType()
export class StoreReactivationRequestType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  storeName!: string;

  @Field()
  submittedByUserId!: string;

  @Field(() => String, { nullable: true })
  submittedByFullName?: string | null;

  @Field(() => String, { nullable: true })
  submittedByEmail?: string | null;

  @Field()
  title!: string;

  @Field()
  content!: string;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  reviewNote?: string | null;

  @Field(() => [StoreReactivationRequestImageType])
  images!: StoreReactivationRequestImageType[];

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;

  @Field(() => Date, { nullable: true })
  reviewedAt?: Date | null;
}

@ObjectType()
export class VendorInvitationType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field()
  status!: string;

  @Field()
  token!: string;

  @Field()
  expiresAt!: string;
}

@ObjectType()
export class AdminTeamMemberType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field()
  fullName!: string;

  @Field()
  isActive!: boolean;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class AdminInvitationType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field()
  status!: string;

  @Field()
  expiresAt!: string;
}

@ObjectType()
export class AdminStoreType {
  @Field()
  id!: string;

  @Field()
  ownerId!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field(() => String, { nullable: true })
  bannerUrl?: string | null;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  contactPhone?: string | null;

  @Field(() => String, { nullable: true })
  contactEmail?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  @Field(() => String, { nullable: true })
  bankAccountName?: string | null;

  @Field(() => String, { nullable: true })
  bankAccountNumber?: string | null;

  @Field(() => String, { nullable: true })
  bankName?: string | null;

  @Field()
  payoutSchedule!: string;

  @Field()
  payoutSchedulePaused!: boolean;

  @Field(() => String, { nullable: true })
  ownerEmail?: string | null;

  @Field(() => String, { nullable: true })
  ownerFullName?: string | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class AdminVendorStoreType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field()
  status!: string;
}

@ObjectType()
export class AdminVendorType {
  @Field()
  id!: string;

  @Field()
  email!: string;

  @Field()
  fullName!: string;

  @Field()
  role!: string;

  @Field()
  isActive!: boolean;

  @Field(() => Date, { nullable: true })
  lastLoginAt?: Date | null;

  @Field()
  createdAt!: Date;

  @Field(() => [AdminVendorStoreType])
  stores!: AdminVendorStoreType[];
}

@ObjectType()
export class AdminVendorMembershipType {
  @Field()
  storeId!: string;

  @Field()
  storeName!: string;

  @Field()
  storeSlug!: string;

  @Field()
  storeStatus!: string;

  @Field()
  role!: string;

  @Field()
  joinedAt!: Date;
}

@ObjectType()
export class AdminVendorActivityType {
  @Field()
  kind!: string;

  @Field()
  occurredAt!: Date;

  @Field(() => String, { nullable: true })
  storeId?: string | null;

  @Field(() => String, { nullable: true })
  storeName?: string | null;

  @Field(() => String, { nullable: true })
  orderNumber?: string | null;
}

@ObjectType()
export class AdminVendorInsightsType {
  @Field(() => Int)
  storeCount!: number;

  @Field(() => Int)
  membershipCount!: number;

  @Field(() => Float)
  totalRevenue!: number;

  @Field(() => Int)
  orderCount!: number;

  @Field(() => Float)
  averageOrderValue!: number;

  @Field(() => Date, { nullable: true })
  lastOrderAt?: Date | null;

  @Field(() => Date, { nullable: true })
  lastActivityAt?: Date | null;

  @Field(() => [AdminVendorMembershipType])
  memberships!: AdminVendorMembershipType[];

  @Field(() => [AdminVendorActivityType])
  activities!: AdminVendorActivityType[];

  @Field(() => [AdminCustomerRecentOrder])
  recentOrders!: AdminCustomerRecentOrder[];
}

@ObjectType()
export class AdminVendorDetailType extends AdminVendorType {
  @Field()
  emailVerified!: boolean;

  @Field(() => AdminVendorInsightsType)
  insights!: AdminVendorInsightsType;
}

@ObjectType()
export class ReviewImageType {
  @Field()
  id!: string;

  @Field()
  url!: string;
}

@ObjectType()
export class ReviewReplyType {
  @Field()
  id!: string;

  @Field()
  body!: string;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class StoreProductReviewType {
  @Field()
  id!: string;

  @Field()
  productId!: string;

  @Field()
  productName!: string;

  @Field(() => String, { nullable: true })
  productSlug?: string | null;

  @Field(() => String, { nullable: true })
  productImageUrl?: string | null;

  @Field(() => Int)
  rating!: number;

  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field()
  customerName!: string;

  @Field()
  createdAt!: Date;

  @Field(() => [ReviewImageType])
  images!: ReviewImageType[];

  @Field(() => ReviewReplyType, { nullable: true })
  reply?: ReviewReplyType | null;
}

@ObjectType()
export class StoreProductReviewConnection {
  @Field(() => [StoreProductReviewType])
  items!: StoreProductReviewType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class ProductReviewBreakdownType {
  @Field()
  productId!: string;

  @Field()
  productName!: string;

  @Field(() => Float)
  averageRating!: number;

  @Field(() => Int)
  reviewCount!: number;
}

@ObjectType()
export class StoreReviewSummaryType {
  @Field(() => Float)
  averageRating!: number;

  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  rating5Count!: number;

  @Field(() => Int)
  rating4Count!: number;

  @Field(() => Int)
  rating3Count!: number;

  @Field(() => Int)
  rating2Count!: number;

  @Field(() => Int)
  rating1Count!: number;

  @Field(() => [ProductReviewBreakdownType])
  productBreakdown!: ProductReviewBreakdownType[];
}

@ObjectType()
export class TopProductType {
  @Field()
  productId!: string;

  @Field()
  name!: string;

  @Field(() => Int)
  unitsSold!: number;

  @Field(() => Float)
  revenue!: number;
}

@ObjectType()
export class MyStoreType {
  @Field()
  id!: string;

  @Field()
  name!: string;

  @Field()
  slug!: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field(() => String, { nullable: true })
  bannerUrl?: string | null;

  @Field(() => String, { nullable: true })
  contactPhone?: string | null;

  @Field(() => String, { nullable: true })
  contactEmail?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  @Field(() => String, { nullable: true })
  bankAccountName?: string | null;

  @Field(() => String, { nullable: true })
  bankAccountNumber?: string | null;

  @Field(() => String, { nullable: true })
  bankName?: string | null;

  @Field(() => String, { nullable: true })
  bankCode?: string | null;

  @Field(() => String, { nullable: true })
  omiseRecipientId?: string | null;

  @Field(() => String)
  omiseRecipientStatus!: string;

  @Field(() => String, { nullable: true })
  omiseRecipientFailureMessage?: string | null;

  @Field()
  status!: string;
}

@ObjectType()
export class AdminCustomerType {
  @Field()
  id!: string;

  @Field()
  phone!: string;

  @Field(() => String, { nullable: true })
  fullName?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  dateOfBirth?: string | null;

  @Field()
  isVerified!: boolean;

  @Field()
  isActive!: boolean;

  @Field(() => Date, { nullable: true })
  lastLoginAt?: Date | null;

  @Field()
  createdAt!: Date;

  @Field()
  updatedAt!: Date;
}

@ObjectType()
export class AdminCustomerConnection {
  @Field(() => [AdminCustomerType])
  items!: AdminCustomerType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class AdminCustomerOrderItemSummary {
  @Field()
  productName!: string;

  @Field(() => Int)
  quantity!: number;

  @Field(() => Float)
  unitPrice!: number;

  @Field(() => Float)
  subtotal!: number;
}

@ObjectType()
export class AdminCustomerRecentOrder {
  @Field()
  id!: string;

  @Field()
  orderNumber!: string;

  @Field()
  status!: string;

  @Field(() => Float)
  total!: number;

  @Field()
  createdAt!: Date;

  @Field(() => [AdminCustomerOrderItemSummary])
  items!: AdminCustomerOrderItemSummary[];
}

@ObjectType()
export class AdminCustomerInsightsType {
  @Field(() => Float)
  totalSpent!: number;

  @Field(() => Int)
  orderCount!: number;

  @Field(() => Float)
  averageOrderValue!: number;

  @Field(() => Date, { nullable: true })
  lastOrderAt?: Date | null;

  @Field(() => Int)
  addressCount!: number;

  @Field(() => Int)
  favoriteCount!: number;

  @Field(() => [AdminCustomerRecentOrder])
  recentOrders!: AdminCustomerRecentOrder[];
}

@ObjectType()
export class AdminCustomerDetailType extends AdminCustomerType {
  @Field(() => AdminCustomerInsightsType)
  insights!: AdminCustomerInsightsType;
}

@ObjectType()
export class VendorCustomerType {
  @Field()
  id!: string;

  @Field()
  phone!: string;

  @Field(() => String, { nullable: true })
  fullName?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field()
  isVerified!: boolean;

  @Field(() => Date, { nullable: true })
  lastLoginAt?: Date | null;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class VendorCustomerStoreReviewSummary {
  @Field()
  id!: string;

  @Field()
  productName!: string;

  @Field(() => Int)
  rating!: number;

  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class VendorCustomerFavoriteProductSummary {
  @Field()
  productName!: string;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class VendorCustomerStoreInsightsType {
  @Field(() => Float)
  totalSpent!: number;

  @Field(() => Int)
  orderCount!: number;

  @Field(() => Float)
  averageOrderValue!: number;

  @Field(() => Date, { nullable: true })
  lastOrderAt?: Date | null;

  @Field(() => Int)
  favoriteCount!: number;

  @Field(() => Int)
  reviewCount!: number;

  @Field(() => [AdminCustomerRecentOrder])
  recentOrders!: AdminCustomerRecentOrder[];

  @Field(() => [VendorCustomerStoreReviewSummary])
  recentReviews!: VendorCustomerStoreReviewSummary[];

  @Field(() => [VendorCustomerFavoriteProductSummary])
  favoriteProducts!: VendorCustomerFavoriteProductSummary[];
}

@ObjectType()
export class VendorCustomerDetailType extends VendorCustomerType {
  @Field(() => VendorCustomerStoreInsightsType)
  insights!: VendorCustomerStoreInsightsType;
}

@ObjectType()
export class VendorCustomerConnection {
  @Field(() => [VendorCustomerType])
  items!: VendorCustomerType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class AdminAuditLogType {
  @Field()
  id!: string;

  @Field()
  actorType!: string;

  @Field(() => String, { nullable: true })
  actorId?: string | null;

  @Field(() => String, { nullable: true })
  actorLabel?: string | null;

  @Field()
  action!: string;

  @Field()
  resourceType!: string;

  @Field(() => String, { nullable: true })
  resourceId?: string | null;

  @Field(() => String, { nullable: true })
  metadata?: string | null;

  @Field(() => String, { nullable: true })
  ipAddress?: string | null;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class AdminAuditLogConnection {
  @Field(() => [AdminAuditLogType])
  items!: AdminAuditLogType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}
