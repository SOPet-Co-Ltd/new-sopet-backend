import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Review } from '../../database/entities/review.entity';

/**
 * A customer review is proof the order was delivered and accepted.
 * Cancel and refund must stop once any review exists for the order.
 */
export async function assertOrderHasNoReviews(
  dataSource: DataSource,
  orderId: string,
): Promise<void> {
  const reviewCount = await dataSource.getRepository(Review).count({
    where: { orderId },
  });

  if (reviewCount > 0) {
    throw new BadRequestException({
      code: 'ORDER_REVIEWED_CANNOT_CANCEL',
      message: 'Order cannot be cancelled or refunded after it has been reviewed',
    });
  }
}
