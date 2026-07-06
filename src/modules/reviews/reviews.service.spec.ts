import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReviewsService, maskCustomerName } from './reviews.service';
import { Review, ReviewStatus } from '../../database/entities/review.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';

describe('ReviewsService', () => {
  let service: ReviewsService;

  const reviewRepo = {
    create: jest.fn(<T extends object>(x: T): T => x),
    save: jest.fn((x: object) => Promise.resolve({ id: 'review-1', ...x })),
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const orderRepo = {
    findOne: jest.fn(),
  };

  const productRepo = {
    find: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
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

  describe('create', () => {
    const input = {
      customerId: 'cust-1',
      productId: 'prod-1',
      orderId: 'order-1',
      rating: 5,
      comment: 'Great product',
    };

    it('throws when order not found', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.create(input)).rejects.toThrow(NotFoundException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('throws when order not DELIVERED', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        status: OrderStatus.SHIPPED,
        items: [],
      });

      await expect(service.create(input)).rejects.toThrow(BadRequestException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('throws when product not in order', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        status: OrderStatus.DELIVERED,
        items: [{ productVariant: { productId: 'other-prod' } }],
      });

      await expect(service.create(input)).rejects.toThrow(BadRequestException);
      expect(reviewRepo.save).not.toHaveBeenCalled();
    });

    it('saves review on success', async () => {
      orderRepo.findOne.mockResolvedValue({
        id: 'order-1',
        customerId: 'cust-1',
        status: OrderStatus.DELIVERED,
        items: [{ productVariant: { productId: 'prod-1' } }],
      });

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
