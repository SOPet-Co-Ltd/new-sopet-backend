import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, SelectQueryBuilder } from 'typeorm';
import { Review, ReviewStatus } from '../../database/entities/review.entity';
import { ReviewReply, REVIEW_REPLY_MAX_LENGTH } from '../../database/entities/review-reply.entity';
import { ReviewImage } from '../../database/entities/review-image.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { Customer } from '../../database/entities/customer.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { PaginatedResponse } from '../../common/interfaces';
import { StoresService } from '../stores/stores.service';

export type StoreReviewReplyFilter = 'all' | 'unreplied' | 'replied';
export type StoreReviewRatingFilter = 'all' | '1' | '2' | '3' | '4' | '5';

export const STORE_PRODUCT_REVIEWS_DEFAULT_LIMIT = 20;
export const STORE_PRODUCT_REVIEWS_MAX_LIMIT = 100;

export function normalizeStoreReviewReplyFilter(value?: string | null): StoreReviewReplyFilter {
  if (value === 'unreplied' || value === 'replied') {
    return value;
  }
  return 'all';
}

export function normalizeStoreReviewRatingFilter(value?: string | null): StoreReviewRatingFilter {
  if (value === '1' || value === '2' || value === '3' || value === '4' || value === '5') {
    return value;
  }
  return 'all';
}

export function maskCustomerName(
  customer: Pick<Customer, 'fullName' | 'phone'> | null | undefined,
): string {
  const fullName = customer?.fullName?.trim();
  if (!fullName) {
    return 'ลูกค้า';
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0];
  }

  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0);
  return `${firstName} ${lastInitial}.`;
}

export function getReviewWindowDays(): number {
  const raw = process.env.REVIEW_WINDOW_DAYS;
  if (raw === undefined || raw.trim() === '') {
    return 30;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 30;
  }
  return parsed;
}

export function shouldAutoApproveReview(): boolean {
  const raw = process.env.REVIEW_AUTO_APPROVE;
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return process.env.NODE_ENV !== 'production';
}

export function resolveInitialReviewStatus(): ReviewStatus {
  return ReviewStatus.APPROVED;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
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

export function resolveItemDeliveredAt(item: OrderItem, order: Order): Date | null {
  if (item.deliveredAt) {
    return item.deliveredAt;
  }

  const deliveredHistory = order.statusHistory
    ?.filter((entry) => entry.status === OrderStatus.DELIVERED)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (deliveredHistory) {
    return deliveredHistory.createdAt;
  }

  if (order.status === OrderStatus.DELIVERED) {
    return order.updatedAt;
  }

  return null;
}

export interface ReviewReplyResult {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export const REVIEW_MAX_IMAGES = 5;

export interface ReviewImageResult {
  id: string;
  url: string;
}

export interface StoreProductReviewResult {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  productImageUrl: string | null;
  rating: number;
  comment: string | null;
  customerName: string;
  createdAt: Date;
  images: ReviewImageResult[];
  reply: ReviewReplyResult | null;
}

export interface StoreReviewSummaryResult {
  averageRating: number;
  totalCount: number;
  rating5Count: number;
  rating4Count: number;
  rating3Count: number;
  rating2Count: number;
  rating1Count: number;
  productBreakdown: Array<{
    productId: string;
    productName: string;
    averageRating: number;
    reviewCount: number;
  }>;
}

export interface CustomerReviewableItemResult {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  productImageUrl: string | null;
  deliveredAt: Date;
  reviewDeadline: Date;
}

export interface CustomerReviewResult {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  productImageUrl: string | null;
  orderId: string;
  rating: number;
  comment: string | null;
  status: string;
  createdAt: Date;
  images: ReviewImageResult[];
}

function mapReply(reply: ReviewReply | null | undefined): ReviewReplyResult | null {
  if (!reply) {
    return null;
  }

  return {
    id: reply.id,
    body: reply.body,
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt,
  };
}

function mapReviewImages(images: ReviewImage[] | null | undefined): ReviewImageResult[] {
  return (images ?? []).map((image) => ({
    id: image.id,
    url: image.url,
  }));
}

function mapReviewToStoreProductReview(review: Review): StoreProductReviewResult {
  return {
    id: review.id,
    productId: review.productId,
    productName: review.product?.name ?? 'Unknown',
    productSlug: review.product?.slug ?? null,
    productImageUrl: review.product ? resolveThumbnailUrl(review.product.images) : null,
    rating: review.rating,
    comment: review.comment,
    customerName: maskCustomerName(review.customer),
    createdAt: review.createdAt,
    images: mapReviewImages(review.images),
    reply: mapReply(review.reply),
  };
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(ReviewReply)
    private readonly reviewReplyRepository: Repository<ReviewReply>,
    @InjectRepository(ReviewImage)
    private readonly reviewImageRepository: Repository<ReviewImage>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly storesService: StoresService,
  ) {}

  async create(input: {
    customerId: string;
    productId: string;
    orderId: string;
    rating: number;
    comment?: string;
    imageUrls?: string[];
  }): Promise<Review> {
    const order = await this.orderRepository.findOne({
      where: { id: input.orderId, customerId: input.customerId },
      relations: ['items', 'items.productVariant', 'statusHistory'],
    });

    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' });
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException({
        code: 'ORDER_NOT_REVIEWABLE',
        message: 'Order must be delivered before reviewing',
      });
    }

    const orderItem = order.items?.find(
      (item) => item.productVariant?.productId === input.productId,
    );
    if (!orderItem) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_IN_ORDER',
        message: 'Product was not part of this order',
      });
    }

    const existingReview = await this.reviewRepository.findOne({
      where: {
        customerId: input.customerId,
        orderId: input.orderId,
        productId: input.productId,
      },
    });
    if (existingReview) {
      throw new BadRequestException({
        code: 'REVIEW_ALREADY_EXISTS',
        message: 'You have already reviewed this product for this order',
      });
    }

    const deliveredAt = resolveItemDeliveredAt(orderItem, order);
    if (deliveredAt) {
      const reviewDeadline = addDays(deliveredAt, getReviewWindowDays());
      if (reviewDeadline.getTime() < Date.now()) {
        throw new BadRequestException({
          code: 'REVIEW_WINDOW_EXPIRED',
          message: 'The review window for this order item has expired',
        });
      }
    }

    const status = resolveInitialReviewStatus();
    const imageUrls = this.normalizeReviewImageUrls(input.imageUrls);
    const review = this.reviewRepository.create({
      customerId: input.customerId,
      productId: input.productId,
      orderId: input.orderId,
      rating: input.rating,
      comment: input.comment,
      status,
    });
    const saved = await this.reviewRepository.save(review);
    if (imageUrls.length > 0) {
      const images = imageUrls.map((url) =>
        this.reviewImageRepository.create({ reviewId: saved.id, url }),
      );
      await this.reviewImageRepository.save(images);
    }
    await this.syncProductReviewStats(input.productId);
    const withRelations = await this.reviewRepository.findOne({
      where: { id: saved.id },
      relations: ['customer', 'images'],
    });
    return withRelations ?? saved;
  }

  async findReviewableItemsForCustomer(
    customerId: string,
  ): Promise<CustomerReviewableItemResult[]> {
    const orders = await this.orderRepository.find({
      where: { customerId, status: OrderStatus.DELIVERED },
      relations: [
        'items',
        'items.productVariant',
        'items.productVariant.product',
        'items.productVariant.product.images',
        'statusHistory',
      ],
      order: { createdAt: 'DESC' },
    });

    const existingReviews = await this.reviewRepository.find({
      where: { customerId },
      select: ['orderId', 'productId'],
    });
    const reviewedKeys = new Set(
      existingReviews.map((review) => `${review.orderId}:${review.productId}`),
    );

    const windowDays = getReviewWindowDays();
    const now = Date.now();
    const results: CustomerReviewableItemResult[] = [];

    for (const order of orders) {
      for (const item of order.items ?? []) {
        const productId = item.productVariant?.productId;
        if (!productId) {
          continue;
        }

        const reviewKey = `${order.id}:${productId}`;
        if (reviewedKeys.has(reviewKey)) {
          continue;
        }

        const deliveredAt = resolveItemDeliveredAt(item, order);
        if (!deliveredAt) {
          continue;
        }

        const reviewDeadline = addDays(deliveredAt, windowDays);
        if (reviewDeadline.getTime() < now) {
          continue;
        }

        const product = item.productVariant?.product;
        results.push({
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderItemId: item.id,
          productId,
          productName: product?.name ?? item.productName,
          productSlug: product?.slug ?? null,
          productImageUrl: product ? resolveThumbnailUrl(product.images) : null,
          deliveredAt,
          reviewDeadline,
        });
      }
    }

    return results;
  }

  async findMyReviews(customerId: string, limit = 50, offset = 0): Promise<CustomerReviewResult[]> {
    const cappedLimit = Math.min(Math.max(limit, 0), 100);
    const safeOffset = Math.max(offset, 0);

    const reviews = await this.reviewRepository.find({
      where: { customerId },
      relations: ['product', 'product.images', 'images'],
      order: { createdAt: 'DESC' },
      take: cappedLimit,
      skip: safeOffset,
    });

    return reviews.map((review) => ({
      id: review.id,
      productId: review.productId,
      productName: review.product?.name ?? 'Unknown',
      productSlug: review.product?.slug ?? null,
      productImageUrl: review.product ? resolveThumbnailUrl(review.product.images) : null,
      orderId: review.orderId,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt,
      images: mapReviewImages(review.images),
    }));
  }

  async findByProduct(productId: string): Promise<Review[]> {
    return this.reviewRepository.find({
      where: { productId, status: ReviewStatus.APPROVED },
      relations: ['customer', 'images', 'reply'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByStore(storeId: string): Promise<StoreProductReviewResult[]> {
    const reviews = await this.buildStoreReviewsQuery(storeId)
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('review.customer', 'customer')
      .leftJoinAndSelect('review.reply', 'reply')
      .leftJoinAndSelect('review.images', 'reviewImages')
      .orderBy('review.createdAt', 'DESC')
      .getMany();

    return reviews.map(mapReviewToStoreProductReview);
  }

  async findByStorePaginated(params: {
    storeId: string;
    page?: number;
    limit?: number;
    replyFilter?: StoreReviewReplyFilter;
    ratingFilter?: StoreReviewRatingFilter;
  }): Promise<PaginatedResponse<StoreProductReviewResult>> {
    const page = Math.max(params.page ?? 1, 1);
    const limit = Math.min(
      Math.max(params.limit ?? STORE_PRODUCT_REVIEWS_DEFAULT_LIMIT, 1),
      STORE_PRODUCT_REVIEWS_MAX_LIMIT,
    );
    const replyFilter = params.replyFilter ?? 'all';
    const ratingFilter = params.ratingFilter ?? 'all';

    const filterQuery = this.applyStoreReviewFilters(
      this.buildStoreReviewsFilterQuery(params.storeId).leftJoin('review.reply', 'reply'),
      replyFilter,
      ratingFilter,
    );

    const total = await filterQuery.clone().getCount();

    const idRows = await filterQuery
      .clone()
      .select('review.id', 'id')
      .orderBy('review.createdAt', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{ id: string }>();

    if (idRows.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }

    const reviewIds = idRows.map((row) => row.id);
    const loadedReviews = await this.reviewRepository
      .createQueryBuilder('review')
      .innerJoinAndSelect('review.product', 'product')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('review.customer', 'customer')
      .leftJoinAndSelect('review.reply', 'reply')
      .leftJoinAndSelect('review.images', 'reviewImages')
      .where('review.id IN (:...reviewIds)', { reviewIds })
      .getMany();

    const reviewsById = new Map(loadedReviews.map((review) => [review.id, review]));
    const reviews = reviewIds
      .map((id) => reviewsById.get(id))
      .filter((review): review is Review => review !== undefined);

    return {
      items: reviews.map(mapReviewToStoreProductReview),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  private buildStoreReviewsFilterQuery(storeId: string): SelectQueryBuilder<Review> {
    return this.reviewRepository
      .createQueryBuilder('review')
      .innerJoin('review.product', 'product', 'product.store_id = :storeId', { storeId })
      .where('review.status = :status', { status: ReviewStatus.APPROVED });
  }

  private buildStoreReviewsQuery(storeId: string): SelectQueryBuilder<Review> {
    return this.reviewRepository
      .createQueryBuilder('review')
      .innerJoinAndSelect('review.product', 'product', 'product.store_id = :storeId', { storeId })
      .where('review.status = :status', { status: ReviewStatus.APPROVED });
  }

  private applyStoreReviewFilters(
    query: SelectQueryBuilder<Review>,
    replyFilter: StoreReviewReplyFilter,
    ratingFilter: StoreReviewRatingFilter,
  ): SelectQueryBuilder<Review> {
    if (replyFilter === 'unreplied') {
      query.andWhere('reply.id IS NULL');
    } else if (replyFilter === 'replied') {
      query.andWhere('reply.id IS NOT NULL');
    }

    if (ratingFilter !== 'all') {
      query.andWhere('review.rating = :rating', { rating: Number(ratingFilter) });
    }

    return query;
  }

  async createReviewReply(params: {
    userId: string;
    reviewId: string;
    body: string;
  }): Promise<ReviewReply> {
    const review = await this.assertVendorCanAccessReview(params.userId, params.reviewId);
    if (review.status !== ReviewStatus.APPROVED) {
      throw new BadRequestException({
        code: 'REVIEW_NOT_APPROVED',
        message: 'Review is not approved',
      });
    }

    const existingReply = await this.reviewReplyRepository.findOne({
      where: { reviewId: params.reviewId },
    });
    if (existingReply) {
      throw new BadRequestException({
        code: 'REVIEW_REPLY_ALREADY_EXISTS',
        message: 'A reply already exists for this review',
      });
    }

    const normalizedBody = this.validateReplyBody(params.body);
    const reply = this.reviewReplyRepository.create({
      reviewId: params.reviewId,
      body: normalizedBody,
    });
    try {
      return await this.reviewReplyRepository.save(reply);
    } catch (error) {
      if (this.isReviewReplyUniqueViolation(error)) {
        throw new BadRequestException({
          code: 'REVIEW_REPLY_ALREADY_EXISTS',
          message: 'A reply already exists for this review',
        });
      }
      throw error;
    }
  }

  async updateReviewReply(params: {
    userId: string;
    replyId: string;
    body: string;
  }): Promise<ReviewReply> {
    const reply = await this.reviewReplyRepository.findOne({
      where: { id: params.replyId },
      relations: ['review', 'review.product'],
    });
    if (!reply) {
      throw new NotFoundException({
        code: 'REVIEW_REPLY_NOT_FOUND',
        message: 'Review reply not found',
      });
    }

    await this.assertVendorCanAccessReview(params.userId, reply.reviewId);

    if (reply.review.status !== ReviewStatus.APPROVED) {
      throw new BadRequestException({
        code: 'REVIEW_NOT_APPROVED',
        message: 'Review is not approved',
      });
    }

    const normalizedBody = this.validateReplyBody(params.body);
    reply.body = normalizedBody;
    return this.reviewReplyRepository.save(reply);
  }

  private async assertVendorCanAccessReview(userId: string, reviewId: string): Promise<Review> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
      relations: ['product'],
    });
    if (!review?.product) {
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'Review not found',
      });
    }

    const hasAccess = await this.storesService.userHasStoreAccess(userId, review.product.storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'STORE_ACCESS_DENIED',
        message: 'No access to this store',
      });
    }

    return review;
  }

  private validateReplyBody(body: string): string {
    const normalized = body.replace(/\0/g, '').trim();
    if (!normalized) {
      throw new BadRequestException({
        code: 'REVIEW_REPLY_BODY_EMPTY',
        message: 'Reply body cannot be empty',
      });
    }
    if (normalized.length > REVIEW_REPLY_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'REVIEW_REPLY_BODY_TOO_LONG',
        message: `Reply body cannot exceed ${REVIEW_REPLY_MAX_LENGTH} characters`,
      });
    }
    if (/<[^>]+>/.test(normalized)) {
      throw new BadRequestException({
        code: 'REVIEW_REPLY_BODY_INVALID',
        message: 'Reply body cannot contain HTML',
      });
    }
    return normalized;
  }

  private normalizeReviewImageUrls(imageUrls?: string[]): string[] {
    if (!imageUrls?.length) {
      return [];
    }

    const normalized = imageUrls.map((url) => url.replace(/\0/g, '').trim()).filter(Boolean);

    if (normalized.length > REVIEW_MAX_IMAGES) {
      throw new BadRequestException({
        code: 'REVIEW_TOO_MANY_IMAGES',
        message: `A review cannot have more than ${REVIEW_MAX_IMAGES} images`,
      });
    }

    return normalized;
  }

  private isReviewReplyUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error.driverError as { code?: string })?.code === '23505'
    );
  }

  async getStoreReviewSummary(storeId: string): Promise<StoreReviewSummaryResult> {
    const products = await this.productRepository.find({
      where: { storeId },
      select: ['id', 'name'],
    });

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return {
        averageRating: 0,
        totalCount: 0,
        rating5Count: 0,
        rating4Count: 0,
        rating3Count: 0,
        rating2Count: 0,
        rating1Count: 0,
        productBreakdown: [],
      };
    }

    const summaryRows = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.productId', 'productId')
      .addSelect('AVG(review.rating)', 'averageRating')
      .addSelect('COUNT(review.id)', 'reviewCount')
      .where('review.productId IN (:...productIds)', { productIds })
      .andWhere('review.status = :status', { status: ReviewStatus.APPROVED })
      .groupBy('review.productId')
      .getRawMany<{
        productId: string;
        averageRating: string;
        reviewCount: string;
      }>();

    const productNameById = new Map(products.map((p) => [p.id, p.name]));
    const productBreakdown = summaryRows.map((row) => ({
      productId: row.productId,
      productName: productNameById.get(row.productId) ?? 'Unknown',
      averageRating: Number(row.averageRating),
      reviewCount: Number(row.reviewCount),
    }));

    const totalCount = productBreakdown.reduce((sum, p) => sum + p.reviewCount, 0);
    const averageRating =
      totalCount > 0
        ? productBreakdown.reduce((sum, p) => sum + p.averageRating * p.reviewCount, 0) / totalCount
        : 0;

    const ratingRows = await this.reviewRepository
      .createQueryBuilder('review')
      .select('review.rating', 'rating')
      .addSelect('COUNT(review.id)', 'count')
      .where('review.productId IN (:...productIds)', { productIds })
      .andWhere('review.status = :status', { status: ReviewStatus.APPROVED })
      .groupBy('review.rating')
      .getRawMany<{
        rating: string;
        count: string;
      }>();

    const ratingCounts = {
      rating5Count: 0,
      rating4Count: 0,
      rating3Count: 0,
      rating2Count: 0,
      rating1Count: 0,
    };

    for (const row of ratingRows) {
      const rating = Number(row.rating);
      const count = Number(row.count);
      if (rating === 5) ratingCounts.rating5Count = count;
      if (rating === 4) ratingCounts.rating4Count = count;
      if (rating === 3) ratingCounts.rating3Count = count;
      if (rating === 2) ratingCounts.rating2Count = count;
      if (rating === 1) ratingCounts.rating1Count = count;
    }

    return {
      averageRating,
      totalCount,
      ...ratingCounts,
      productBreakdown,
    };
  }

  private async syncProductReviewStats(productId: string): Promise<void> {
    const summary = await this.reviewRepository
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'averageRating')
      .addSelect('COUNT(review.id)', 'reviewCount')
      .where('review.productId = :productId', { productId })
      .andWhere('review.status = :status', { status: ReviewStatus.APPROVED })
      .getRawOne<{ averageRating: string | null; reviewCount: string }>();

    const reviewCount = Number(summary?.reviewCount ?? 0);
    const averageRating = summary?.averageRating ? Number(summary.averageRating) : 0;

    await this.productRepository.update(productId, {
      reviewCount,
      averageRating: Math.round(averageRating * 100) / 100,
    });
  }
}
