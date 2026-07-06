import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { UseGuards, ForbiddenException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ReviewsService, maskCustomerName } from './reviews.service';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ReviewImageType,
  StoreProductReviewType,
  StoreReviewSummaryType,
} from '../../graphql/models/types';
import { StoresService } from '../stores/stores.service';
import { Review } from '../../database/entities/review.entity';

@ObjectType()
export class ReviewType {
  @Field()
  id: string;

  @Field()
  productId: string;

  @Field(() => Int)
  rating: number;

  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field()
  status: string;

  @Field()
  createdAt: Date;

  @Field()
  customerName: string;

  @Field(() => [ReviewImageType])
  images: ReviewImageType[];
}

function mapReviewToType(review: Review): ReviewType {
  return {
    id: review.id,
    productId: review.productId,
    rating: review.rating,
    comment: review.comment,
    status: review.status,
    createdAt: review.createdAt,
    customerName: maskCustomerName(review.customer),
    images: (review.images ?? []).map((image) => ({
      id: image.id,
      url: image.url,
    })),
  };
}

@InputType()
export class CreateReviewInput {
  @Field()
  @IsUUID()
  productId: string;

  @Field()
  @IsUUID()
  orderId: string;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  comment?: string;
}

@Resolver()
export class ReviewsResolver {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => [ReviewType])
  @Public()
  async productReviews(@Args('productId') productId: string): Promise<ReviewType[]> {
    const reviews = await this.reviewsService.findByProduct(productId);
    return reviews.map(mapReviewToType);
  }

  @Query(() => [StoreProductReviewType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeProductReviews(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StoreProductReviewType[]> {
    const hasAccess = await this.storesService.userHasStoreAccess(userId, storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'STORE_ACCESS_DENIED',
        message: 'No access to this store',
      });
    }
    return this.reviewsService.findByStore(storeId);
  }

  @Query(() => StoreReviewSummaryType)
  @Public()
  async storeReviewSummary(@Args('storeId') storeId: string): Promise<StoreReviewSummaryType> {
    return this.reviewsService.getStoreReviewSummary(storeId);
  }

  @Mutation(() => ReviewType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async createReview(
    @CurrentUser('id') customerId: string,
    @Args('input') input: CreateReviewInput,
  ): Promise<ReviewType> {
    const review = await this.reviewsService.create({
      customerId,
      productId: input.productId,
      orderId: input.orderId,
      rating: input.rating,
      comment: input.comment,
    });
    return mapReviewToType(review);
  }
}
