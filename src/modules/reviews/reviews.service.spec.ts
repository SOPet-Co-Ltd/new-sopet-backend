import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  ReviewsService,
  maskCustomerName,
  getReviewWindowDays,
  addDays,
  resolveInitialReviewStatus,
} from './reviews.service';
import { Review, ReviewStatus } from '../../database/entities/review.entity';
import { ReviewImage } from '../../database/entities/review-image.entity';
import { ReviewReply } from '../../database/entities/review-reply.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { StoresService } from '../stores/stores.service';

describe('ReviewsService', () => {
  let service: ReviewsService;
  const originalReviewWindowDays = process.env.REVIEW_WINDOW_DAYS;

  const reviewRepo = {
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn((x: object) => Promise.resolve({ id: 'review-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const orderRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const productRepo = {
    find: jest.fn(),
    update: jest.fn(),
  };

  const reviewReplyRepo = {
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn((x: object) => Promise.resolve({ id: 'reply-1', ...x })),
    findOne: jest.fn(),
  };

  const reviewImageRepo = {
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn((images: object[]) => Promise.resolve(images)),
  };

  const storesService = {
    userHasStoreAccess: jest.fn(),
  };

  const approvedReview = {
    id: 'review-1',
    status: ReviewStatus.APPROVED,
    productId: 'prod-1',
    product: { storeId: 'store-1' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.REVIEW_WINDOW_DAYS;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: getRepositoryToken(ReviewReply), useValue: reviewReplyRepo },
        { provide: getRepositoryToken(ReviewImage), useValue: reviewImageRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: StoresService, useValue: storesService },
      ],
    }).compile();

    service = module.get(ReviewsService);
  });

  afterAll(() => {
    if (originalReviewWindowDays === undefined) {
      delete process.env.REVIEW_WINDOW_DAYS;
    } else {
      process.env.REVIEW_WINDOW_DAYS = originalReviewWindowDays;
    }
  });

  describe('create', () => {
    const input = {
      customerId: 'cust-1',
      productId: 'prod-1',
      orderId: 'order-1',
      rating: 5,
      comment: 'Great product',
    };

    const deliveredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const deliveredOrder = {
      id: 'order-1',
      customerId: 'cust-1',
      status: OrderStatus.DELIVERED,
      updatedAt: deliveredAt,
      items: [
        {
          id: 'item-1',
          productName: 'Cat Food',
          deliveredAt,
          productVariant: { productId: 'prod-1' },
        },
      ],
      statusHistory: [],
    };

    it('throws when order not found', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.create(input)).rejects.toThrow(NotFoundException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('throws when order not DELIVERED', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...deliveredOrder,
        status: OrderStatus.SHIPPED,
      });

      await expect(service.create(input)).rejects.toThrow(BadRequestException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('throws when product not in order', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...deliveredOrder,
        items: [{ productVariant: { productId: 'other-prod' } }],
      });

      await expect(service.create(input)).rejects.toThrow(BadRequestException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('throws REVIEW_WINDOW_EXPIRED when deadline passed', async () => {
      const expiredDeliveredAt = new Date('2020-01-01T10:00:00.000Z');
      orderRepo.findOne.mockResolvedValue({
        ...deliveredOrder,
        items: [
          {
            id: 'item-1',
            deliveredAt: expiredDeliveredAt,
            productVariant: { productId: 'prod-1' },
          },
        ],
      });
      reviewRepo.findOne.mockResolvedValue(null);

      await expect(service.create(input)).rejects.toMatchObject({
        response: { code: 'REVIEW_WINDOW_EXPIRED' },
      });
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('saves review on success', async () => {
      orderRepo.findOne.mockResolvedValue(deliveredOrder);
      reviewRepo.findOne.mockResolvedValue(null);
      reviewRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ averageRating: '5', reviewCount: '1' }),
      })) as never;
      productRepo.update = jest.fn().mockResolvedValue(undefined);

      const result = await service.create(input);

      expect(reviewRepo.create).toHaveBeenCalledWith({
        customerId: input.customerId,
        productId: input.productId,
        orderId: input.orderId,
        rating: input.rating,
        comment: input.comment,
        status: ReviewStatus.APPROVED,
      });
      expect(reviewRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('review-1');
      expect(result.status).toBe(ReviewStatus.APPROVED);
      expect(productRepo.update).toHaveBeenCalledWith('prod-1', {
        reviewCount: 1,
        averageRating: 5,
      });
    });

    it('persists up to five review images', async () => {
      orderRepo.findOne.mockResolvedValue(deliveredOrder);
      reviewRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'review-1',
        status: ReviewStatus.APPROVED,
        images: [{ id: 'img-1', url: 'https://cdn.example.com/1.webp' }],
      });
      reviewRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ averageRating: '5', reviewCount: '1' }),
      })) as never;
      productRepo.update = jest.fn().mockResolvedValue(undefined);

      await service.create({
        ...input,
        imageUrls: ['https://cdn.example.com/1.webp'],
      });

      expect(reviewImageRepo.create).toHaveBeenCalledWith({
        reviewId: 'review-1',
        url: 'https://cdn.example.com/1.webp',
      });
      expect(reviewImageRepo.save).toHaveBeenCalled();
    });

    it('rejects more than five review images', async () => {
      orderRepo.findOne.mockResolvedValue(deliveredOrder);
      reviewRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          ...input,
          imageUrls: Array.from(
            { length: 6 },
            (_, index) => `https://cdn.example.com/${index}.webp`,
          ),
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_TOO_MANY_IMAGES' },
      });
    });
  });

  describe('getReviewWindowDays', () => {
    it('defaults to 30 when env unset', () => {
      delete process.env.REVIEW_WINDOW_DAYS;
      expect(getReviewWindowDays()).toBe(30);
    });

    it('reads REVIEW_WINDOW_DAYS from env', () => {
      process.env.REVIEW_WINDOW_DAYS = '14';
      expect(getReviewWindowDays()).toBe(14);
    });
  });

  describe('findReviewableItemsForCustomer', () => {
    const deliveredAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    it('returns only delivered orders without existing reviews and within window', async () => {
      orderRepo.find.mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: OrderStatus.DELIVERED,
          updatedAt: deliveredAt,
          items: [
            {
              id: 'item-1',
              productName: 'Cat Food',
              deliveredAt,
              productVariant: {
                productId: 'prod-1',
                product: {
                  id: 'prod-1',
                  name: 'Cat Food Premium',
                  slug: 'cat-food',
                  images: [
                    { url: 'https://cdn.example.com/cat.jpg', sortOrder: 0, isThumbnail: true },
                  ],
                },
              },
            },
          ],
          statusHistory: [],
        },
        {
          id: 'order-2',
          orderNumber: 'ORD-002',
          status: OrderStatus.SHIPPED,
          items: [],
          statusHistory: [],
        },
      ]);
      reviewRepo.find.mockResolvedValue([]);

      const results = await service.findReviewableItemsForCustomer('cust-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        orderId: 'order-1',
        orderNumber: 'ORD-001',
        orderItemId: 'item-1',
        productId: 'prod-1',
        productName: 'Cat Food Premium',
        productSlug: 'cat-food',
        productImageUrl: 'https://cdn.example.com/cat.jpg',
      });
      expect(results[0].reviewDeadline).toEqual(addDays(deliveredAt, 30));
    });

    it('excludes already reviewed customer+order+product pairs', async () => {
      orderRepo.find.mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: OrderStatus.DELIVERED,
          updatedAt: deliveredAt,
          items: [
            {
              id: 'item-1',
              deliveredAt,
              productVariant: {
                productId: 'prod-1',
                product: { name: 'Cat Food', slug: 'cat-food', images: [] },
              },
            },
          ],
          statusHistory: [],
        },
      ]);
      reviewRepo.find.mockResolvedValue([{ orderId: 'order-1', productId: 'prod-1' }]);

      const results = await service.findReviewableItemsForCustomer('cust-1');

      expect(results).toEqual([]);
    });

    it('excludes items past review window', async () => {
      const expiredDeliveredAt = new Date('2020-01-01T10:00:00.000Z');
      orderRepo.find.mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'ORD-001',
          status: OrderStatus.DELIVERED,
          updatedAt: expiredDeliveredAt,
          items: [
            {
              id: 'item-1',
              deliveredAt: expiredDeliveredAt,
              productVariant: {
                productId: 'prod-1',
                product: { name: 'Cat Food', slug: 'cat-food', images: [] },
              },
            },
          ],
          statusHistory: [],
        },
      ]);
      reviewRepo.find.mockResolvedValue([]);

      const results = await service.findReviewableItemsForCustomer('cust-1');

      expect(results).toEqual([]);
    });
  });

  describe('findMyReviews', () => {
    it('returns reviews ordered by createdAt DESC with capped limit', async () => {
      const older = new Date('2026-05-01T10:00:00.000Z');
      const newer = new Date('2026-06-01T10:00:00.000Z');
      reviewRepo.find.mockResolvedValue([
        {
          id: 'review-2',
          productId: 'prod-2',
          orderId: 'order-2',
          rating: 4,
          comment: 'Good',
          status: ReviewStatus.APPROVED,
          createdAt: newer,
          product: { name: 'Dog Food', slug: 'dog-food', images: [] },
          images: [{ id: 'img-2', url: 'https://example.com/review-2.jpg' }],
        },
        {
          id: 'review-1',
          productId: 'prod-1',
          orderId: 'order-1',
          rating: 5,
          comment: 'Great',
          status: ReviewStatus.PENDING,
          createdAt: older,
          product: { name: 'Cat Food', slug: 'cat-food', images: [] },
          images: [],
        },
      ]);

      const results = await service.findMyReviews('cust-1', 101, -1);

      expect(reviewRepo.find).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        relations: ['product', 'product.images', 'images'],
        order: { createdAt: 'DESC' },
        take: 100,
        skip: 0,
      });
      expect(results[0].id).toBe('review-2');
      expect(results[0].images).toEqual([{ id: 'img-2', url: 'https://example.com/review-2.jpg' }]);
      expect(results[1].id).toBe('review-1');
      expect(results[1].images).toEqual([]);
    });
  });

  describe('maskCustomerName', () => {
    it('returns first name and last initial for multi-part names', () => {
      expect(maskCustomerName({ fullName: 'สมชาย ใจดี', phone: '0812345678' })).toBe('สมชาย ใ.');
      expect(maskCustomerName({ fullName: 'John Doe', phone: '0899999999' })).toBe('John D.');
    });

    it('returns first name only for single-part names', () => {
      expect(maskCustomerName({ fullName: 'สมชาย', phone: '0812345678' })).toBe('สมชาย');
    });

    it('returns "ลูกค้า" when fullName is missing', () => {
      expect(maskCustomerName({ fullName: null, phone: '0812345678' })).toBe('ลูกค้า');
      expect(maskCustomerName(null)).toBe('ลูกค้า');
    });

    it('never exposes raw phone number', () => {
      const masked = maskCustomerName({ fullName: null, phone: '0812345678' });
      expect(masked).not.toContain('0812');
    });
  });

  describe('findByProduct', () => {
    it('loads customer and images relations for approved reviews', async () => {
      reviewRepo.find.mockResolvedValue([]);

      await service.findByProduct('prod-1');

      expect(reviewRepo.find).toHaveBeenCalledWith({
        where: { productId: 'prod-1', status: ReviewStatus.APPROVED },
        relations: ['customer', 'images', 'reply'],
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('resolveInitialReviewStatus', () => {
    it('always returns APPROVED regardless of REVIEW_AUTO_APPROVE', () => {
      process.env.REVIEW_AUTO_APPROVE = 'false';
      expect(resolveInitialReviewStatus()).toBe(ReviewStatus.APPROVED);
    });
  });

  describe('findByStore', () => {
    it('queries approved reviews scoped to store with reply relation', async () => {
      const getMany = jest.fn().mockResolvedValue([
        {
          id: 'review-1',
          productId: 'prod-1',
          rating: 5,
          comment: 'Great',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          product: { name: 'Dog Food', slug: 'dog-food', images: [] },
          customer: { fullName: 'John Doe', phone: '0812345678' },
          reply: null,
        },
      ]);
      reviewRepo.createQueryBuilder = jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany,
      })) as never;

      const results = await service.findByStore('store-1');

      expect(reviewRepo.createQueryBuilder).toHaveBeenCalledWith('review');
      expect(getMany).toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        id: 'review-1',
        productName: 'Dog Food',
        productSlug: 'dog-food',
        reply: null,
      });
    });
  });

  describe('findByStorePaginated', () => {
    it('returns paginated reviews with filters and metadata', async () => {
      const getRawMany = jest.fn().mockResolvedValue([{ id: 'review-2' }]);
      const getMany = jest.fn().mockResolvedValue([
        {
          id: 'review-2',
          productId: 'prod-2',
          rating: 3,
          comment: 'Okay',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          product: { name: 'Cat Food', slug: 'cat-food', images: [] },
          customer: { fullName: 'Jane Doe', phone: '0899999999' },
          reply: null,
        },
      ]);
      const getCount = jest.fn().mockResolvedValue(25);
      const createQueryBuilder = jest.fn(() => ({
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        clone: jest.fn().mockReturnThis(),
        getMany,
        getCount,
        getRawMany,
      })) as never;
      reviewRepo.createQueryBuilder = createQueryBuilder;

      const result = await service.findByStorePaginated({
        storeId: 'store-1',
        page: 2,
        limit: 20,
        replyFilter: 'unreplied',
        ratingFilter: '3',
      });

      expect(getCount).toHaveBeenCalled();
      expect(getRawMany).toHaveBeenCalled();
      expect(getMany).toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({
        id: 'review-2',
        productName: 'Cat Food',
      });
      expect(result.pagination).toEqual({
        page: 2,
        limit: 20,
        total: 25,
        totalPages: 2,
      });
    });
  });

  describe('createReviewReply', () => {
    it('creates reply when vendor has store access', async () => {
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(true);
      reviewReplyRepo.findOne.mockResolvedValue(null);
      reviewReplyRepo.save.mockResolvedValue({
        id: 'reply-1',
        reviewId: 'review-1',
        body: 'Thanks',
      });

      const result = await service.createReviewReply({
        userId: 'vendor-1',
        reviewId: 'review-1',
        body: 'Thanks',
      });

      expect(result.id).toBe('reply-1');
      expect(reviewReplyRepo.create).toHaveBeenCalledWith({
        reviewId: 'review-1',
        body: 'Thanks',
      });
    });

    it('rejects duplicate reply before save', async () => {
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(true);
      reviewReplyRepo.findOne.mockResolvedValue({ id: 'reply-existing' });

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: 'Thanks',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_REPLY_ALREADY_EXISTS' },
      });
    });

    it('maps unique violation on save to REVIEW_REPLY_ALREADY_EXISTS', async () => {
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(true);
      reviewReplyRepo.findOne.mockResolvedValue(null);
      reviewReplyRepo.save.mockRejectedValue(
        new QueryFailedError('INSERT', [], { code: '23505' } as never),
      );

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: 'Thanks',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_REPLY_ALREADY_EXISTS' },
      });
    });

    it('rejects reply on non-approved review', async () => {
      reviewRepo.findOne.mockResolvedValue({
        ...approvedReview,
        status: ReviewStatus.PENDING,
      });
      storesService.userHasStoreAccess.mockResolvedValue(true);

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: 'Thanks',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_NOT_APPROVED' },
      });
    });

    it('rejects when vendor lacks store access', async () => {
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(false);

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: 'Thanks',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects empty and HTML bodies', async () => {
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(true);
      reviewReplyRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: '   ',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_REPLY_BODY_EMPTY' },
      });

      await expect(
        service.createReviewReply({
          userId: 'vendor-1',
          reviewId: 'review-1',
          body: '<script>alert(1)</script>',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_REPLY_BODY_INVALID' },
      });
    });
  });

  describe('updateReviewReply', () => {
    it('updates reply body for approved review', async () => {
      reviewReplyRepo.findOne.mockResolvedValue({
        id: 'reply-1',
        reviewId: 'review-1',
        body: 'Old',
        review: approvedReview,
      });
      reviewRepo.findOne.mockResolvedValue(approvedReview);
      storesService.userHasStoreAccess.mockResolvedValue(true);
      reviewReplyRepo.save.mockImplementation((reply: { body: string }) =>
        Promise.resolve({ id: 'reply-1', ...reply }),
      );

      const result = await service.updateReviewReply({
        userId: 'vendor-1',
        replyId: 'reply-1',
        body: 'Updated',
      });

      expect(result.body).toBe('Updated');
    });

    it('rejects update when review is not approved', async () => {
      reviewReplyRepo.findOne.mockResolvedValue({
        id: 'reply-1',
        reviewId: 'review-1',
        body: 'Old',
        review: { ...approvedReview, status: ReviewStatus.PENDING },
      });
      reviewRepo.findOne.mockResolvedValue({
        ...approvedReview,
        status: ReviewStatus.PENDING,
      });
      storesService.userHasStoreAccess.mockResolvedValue(true);

      await expect(
        service.updateReviewReply({
          userId: 'vendor-1',
          replyId: 'reply-1',
          body: 'Updated',
        }),
      ).rejects.toMatchObject({
        response: { code: 'REVIEW_NOT_APPROVED' },
      });
    });
  });

  describe('getStoreReviewSummary', () => {
    it('returns empty summary when store has no products', async () => {
      productRepo.find.mockResolvedValue([]);

      const result = await service.getStoreReviewSummary('store-1');

      expect(result).toEqual({
        averageRating: 0,
        totalCount: 0,
        productBreakdown: [],
        rating1Count: 0,
        rating2Count: 0,
        rating3Count: 0,
        rating4Count: 0,
        rating5Count: 0,
      });
      expect(reviewRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
