import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsService, maskCustomerName, getReviewWindowDays, addDays } from './reviews.service';
import { Review, ReviewStatus } from '../../database/entities/review.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';

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
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.REVIEW_WINDOW_DAYS;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getRepositoryToken(Review), useValue: reviewRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
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

      const result = await service.create(input);

      expect(reviewRepo.create).toHaveBeenCalledWith({
        ...input,
        status: ReviewStatus.PENDING,
      });
      expect(reviewRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('review-1');
      expect(result.status).toBe(ReviewStatus.PENDING);
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
        },
      ]);

      const results = await service.findMyReviews('cust-1', 101, -1);

      expect(reviewRepo.find).toHaveBeenCalledWith({
        where: { customerId: 'cust-1' },
        relations: ['product', 'product.images'],
        order: { createdAt: 'DESC' },
        take: 100,
        skip: 0,
      });
      expect(results[0].id).toBe('review-2');
      expect(results[1].id).toBe('review-1');
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
        relations: ['customer', 'images'],
        order: { createdAt: 'DESC' },
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
      });
      expect(reviewRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
