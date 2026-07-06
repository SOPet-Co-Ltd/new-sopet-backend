import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { ReviewsResolver } from '../reviews.resolver';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { ReviewsService } from '../reviews.service';
import { StoresService } from '../../stores/stores.service';
import { ReviewStatus } from '../../../database/entities/review.entity';

describe('ReviewsResolver', () => {
  const summary = {
    averageRating: 4.5,
    totalCount: 10,
    productBreakdown: [
      {
        productId: 'prod-1',
        productName: 'Cat Food',
        averageRating: 4.5,
        reviewCount: 10,
      },
    ],
  };

  const emptySummary = {
    averageRating: 0,
    totalCount: 0,
    productBreakdown: [],
  };

  let reviewsService: jest.Mocked<
    Pick<ReviewsService, 'getStoreReviewSummary' | 'findByProduct' | 'create'>
  >;
  let storesService: jest.Mocked<Pick<StoresService, 'userHasStoreAccess'>>;
  let resolver: ReviewsResolver;

  beforeEach(() => {
    reviewsService = {
      getStoreReviewSummary: jest.fn(),
      findByProduct: jest.fn(),
      create: jest.fn(),
    };
    storesService = {
      userHasStoreAccess: jest.fn(),
    };
    resolver = new ReviewsResolver(
      reviewsService as unknown as ReviewsService,
      storesService as unknown as StoresService,
    );
  });

  describe('storeReviewSummary', () => {
    it('is decorated with @Public()', () => {
      const storeReviewSummaryMethod = Object.getOwnPropertyDescriptor(
        ReviewsResolver.prototype,
        'storeReviewSummary',
      )?.value as (...args: unknown[]) => unknown;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, storeReviewSummaryMethod) as
        boolean | undefined;
      expect(isPublic).toBe(true);
    });

    it('returns summary without requiring store access check', async () => {
      reviewsService.getStoreReviewSummary.mockResolvedValue(summary);

      const result = await resolver.storeReviewSummary('store-1');

      expect(result).toEqual(summary);
      expect(reviewsService.getStoreReviewSummary).toHaveBeenCalledWith('store-1');
      expect(storesService.userHasStoreAccess).not.toHaveBeenCalled();
    });

    it('returns empty summary when store has no reviews', async () => {
      reviewsService.getStoreReviewSummary.mockResolvedValue(emptySummary);

      const result = await resolver.storeReviewSummary('store-empty');

      expect(result).toEqual(emptySummary);
      expect(storesService.userHasStoreAccess).not.toHaveBeenCalled();
    });
  });

  describe('productReviews', () => {
    it('returns createdAt, masked customerName, and images for approved reviews', async () => {
      const createdAt = new Date('2024-06-15T10:00:00.000Z');
      reviewsService.findByProduct.mockResolvedValue([
        {
          id: 'review-1',
          productId: 'prod-1',
          rating: 5,
          comment: 'Great product',
          status: ReviewStatus.APPROVED,
          createdAt,
          customer: { fullName: 'สมชาย ใจดี', phone: '0812345678' },
          images: [{ id: 'img-1', url: 'https://cdn.example.com/review.jpg' }],
        },
      ] as never);

      const result = await resolver.productReviews('prod-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'review-1',
        productId: 'prod-1',
        rating: 5,
        comment: 'Great product',
        status: ReviewStatus.APPROVED,
        createdAt,
        customerName: 'สมชาย ใ.',
        images: [{ id: 'img-1', url: 'https://cdn.example.com/review.jpg' }],
      });
      expect(result[0].customerName).not.toContain('0812');
    });

    it('returns empty images array when review has no images', async () => {
      reviewsService.findByProduct.mockResolvedValue([
        {
          id: 'review-2',
          productId: 'prod-1',
          rating: 4,
          comment: null,
          status: ReviewStatus.APPROVED,
          createdAt: new Date('2024-06-16T10:00:00.000Z'),
          customer: { fullName: 'John Doe', phone: '0899999999' },
          images: [],
        },
      ] as never);

      const result = await resolver.productReviews('prod-1');

      expect(result[0].images).toEqual([]);
    });

    it('returns "ลูกค้า" when customer has no fullName', async () => {
      reviewsService.findByProduct.mockResolvedValue([
        {
          id: 'review-3',
          productId: 'prod-1',
          rating: 3,
          comment: 'OK',
          status: ReviewStatus.APPROVED,
          createdAt: new Date('2024-06-17T10:00:00.000Z'),
          customer: { fullName: null, phone: '0812345678' },
          images: [],
        },
      ] as never);

      const result = await resolver.productReviews('prod-1');

      expect(result[0].customerName).toBe('ลูกค้า');
      expect(result[0].customerName).not.toContain('0812');
    });
  });

  describe('createReview', () => {
    it('returns extended ReviewType fields including masked customerName', async () => {
      const createdAt = new Date('2024-06-18T10:00:00.000Z');
      reviewsService.create.mockResolvedValue({
        id: 'review-new',
        productId: 'prod-1',
        rating: 5,
        comment: 'Nice',
        status: ReviewStatus.PENDING,
        createdAt,
        customer: { fullName: 'Jane Smith', phone: '0888888888' },
        images: [],
      } as never);

      const result = await resolver.createReview('cust-1', {
        productId: 'prod-1',
        orderId: 'order-1',
        rating: 5,
        comment: 'Nice',
      });

      expect(result).toMatchObject({
        id: 'review-new',
        createdAt,
        customerName: 'Jane S.',
        images: [],
      });
    });
  });

  describe('storeProductReviews', () => {
    it('remains vendor-guarded', () => {
      const storeProductReviewsMethod = Object.getOwnPropertyDescriptor(
        ReviewsResolver.prototype,
        'storeProductReviews',
      )?.value as (...args: unknown[]) => unknown;
      const roles = Reflect.getMetadata(ROLES_KEY, storeProductReviewsMethod) as
        string[] | undefined;
      expect(roles).toEqual(['vendor']);
    });

    it('throws when user has no store access', async () => {
      storesService.userHasStoreAccess.mockResolvedValue(false);

      await expect(resolver.storeProductReviews('store-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
