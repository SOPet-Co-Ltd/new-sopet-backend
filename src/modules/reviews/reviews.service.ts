import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Review, ReviewStatus } from '../../database/entities/review.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { Customer } from '../../database/entities/customer.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';

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

export interface StoreProductReviewResult {
  id: string;
  productId: string;
  productName: string;
  rating: number;
  comment: string | null;
  customerName: string;
  createdAt: Date;
}

export interface StoreReviewSummaryResult {
  averageRating: number;
  totalCount: number;
  productBreakdown: Array<{
    productId: string;
    productName: string;
    averageRating: number;
    reviewCount: number;
  }>;
}

@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(Review)
    private readonly reviewRepository: Repository<Review>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(input: {
    customerId: string;
    productId: string;
    orderId: string;
    rating: number;
    comment?: string;
  }): Promise<Review> {
    const order = await this.orderRepository.findOne({
      where: { id: input.orderId, customerId: input.customerId },
      relations: ['items', 'items.productVariant'],
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

    const hasProduct = order.items?.some(
      (item) => item.productVariant?.productId === input.productId,
    );
    if (!hasProduct) {
      throw new BadRequestException({
        code: 'PRODUCT_NOT_IN_ORDER',
        message: 'Product was not part of this order',
      });
    }

    const review = this.reviewRepository.create({
      ...input,
      status: ReviewStatus.PENDING,
    });
    const saved = await this.reviewRepository.save(review);
    const withRelations = await this.reviewRepository.findOne({
      where: { id: saved.id },
      relations: ['customer', 'images'],
    });
    return withRelations ?? saved;
  }

  async findByProduct(productId: string): Promise<Review[]> {
    return this.reviewRepository.find({
      where: { productId, status: ReviewStatus.APPROVED },
      relations: ['customer', 'images'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByStore(storeId: string): Promise<StoreProductReviewResult[]> {
    const reviews = await this.reviewRepository.find({
      where: { status: ReviewStatus.APPROVED },
      relations: ['product', 'customer'],
      order: { createdAt: 'DESC' },
    });

    return reviews
      .filter((review) => review.product?.storeId === storeId)
      .map((review) => ({
        id: review.id,
        productId: review.productId,
        productName: review.product?.name ?? 'Unknown',
        rating: review.rating,
        comment: review.comment,
        customerName: maskCustomerName(review.customer),
        createdAt: review.createdAt,
      }));
  }

  async getStoreReviewSummary(storeId: string): Promise<StoreReviewSummaryResult> {
    const products = await this.productRepository.find({
      where: { storeId },
      select: ['id', 'name'],
    });

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return { averageRating: 0, totalCount: 0, productBreakdown: [] };
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

    return {
      averageRating,
      totalCount,
      productBreakdown,
    };
  }
}
