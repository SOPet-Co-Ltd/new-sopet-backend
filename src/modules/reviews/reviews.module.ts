import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from '../../database/entities/review.entity';
import { ReviewReply } from '../../database/entities/review-reply.entity';
import { ReviewImage } from '../../database/entities/review-image.entity';
import { Order } from '../../database/entities/order.entity';
import { Product } from '../../database/entities/product.entity';
import { ReviewsService } from './reviews.service';
import { ReviewsResolver } from './reviews.resolver';
import { StoresModule } from '../stores/stores.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Review, ReviewReply, ReviewImage, Order, Product]),
    StoresModule,
  ],
  providers: [ReviewsService, ReviewsResolver],
  exports: [ReviewsService],
})
export class ReviewsModule {}
