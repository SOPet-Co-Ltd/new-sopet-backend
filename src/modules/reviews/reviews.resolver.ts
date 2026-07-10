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
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import {
  ReviewsService,
  maskCustomerName,
  REVIEW_MAX_IMAGES,
  normalizeStoreReviewRatingFilter,
  normalizeStoreReviewReplyFilter,
} from './reviews.service';
import { REVIEW_REPLY_MAX_LENGTH } from '../../database/entities/review-reply.entity';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  ReviewImageType,
  ReviewReplyType,
  StoreProductReviewConnection,
  StoreProductReviewType,
  StoreReviewSummaryType,
} from '../../graphql/models/types';
import { StoresService } from '../stores/stores.service';
import { Review } from '../../database/entities/review.entity';

@ObjectType()
export class CustomerReviewableItemType {
  @Field()
  orderId: string;

  @Field()
  orderNumber: string;

  @Field()
  orderItemId: string;

  @Field()
  productId: string;

  @Field()
  productName: string;

  @Field(() => String, { nullable: true })
  productSlug?: string | null;

  @Field(() => String, { nullable: true })
  productImageUrl?: string | null;

  @Field()
  deliveredAt: Date;

  @Field(() => Date, { nullable: true })
  reviewDeadline?: Date | null;
}

@ObjectType()
export class CustomerReviewType {
  @Field()
  id: string;

  @Field()
  productId: string;

  @Field()
  productName: string;

  @Field(() => String, { nullable: true })
  productSlug?: string | null;

  @Field(() => String, { nullable: true })
  productImageUrl?: string | null;

  @Field()
  orderId: string;

  @Field(() => Int)
  rating: number;

  @Field(() => String, { nullable: true })
  comment?: string | null;

  @Field()
  status: string;

  @Field()
  createdAt: Date;

  @Field(() => [ReviewImageType])
  images: ReviewImageType[];
}

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

  @Field(() => ReviewReplyType, { nullable: true })
  reply?: ReviewReplyType | null;
}

function mapReplyToType(reply: Review['reply']): ReviewReplyType | null {
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
    reply: mapReplyToType(review.reply),
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

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REVIEW_MAX_IMAGES)
  @IsString({ each: true })
  imageUrls?: string[];
}

@InputType()
export class CreateReviewReplyInput {
  @Field()
  @IsUUID()
  reviewId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(REVIEW_REPLY_MAX_LENGTH)
  body: string;
}

@InputType()
export class UpdateReviewReplyInput {
  @Field()
  @IsUUID()
  replyId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(REVIEW_REPLY_MAX_LENGTH)
  body: string;
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

  @Query(() => StoreProductReviewConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storeProductReviews(
    @Args('storeId') storeId: string,
    @CurrentUser('id') userId: string,
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
    @Args('replyFilter', { type: () => String, nullable: true }) replyFilter?: string,
    @Args('ratingFilter', { type: () => String, nullable: true }) ratingFilter?: string,
  ): Promise<StoreProductReviewConnection> {
    const hasAccess = await this.storesService.userHasStoreAccess(userId, storeId);
    if (!hasAccess) {
      throw new ForbiddenException({
        code: 'STORE_ACCESS_DENIED',
        message: 'No access to this store',
      });
    }
    return this.reviewsService.findByStorePaginated({
      storeId,
      page,
      limit,
      replyFilter: normalizeStoreReviewReplyFilter(replyFilter),
      ratingFilter: normalizeStoreReviewRatingFilter(ratingFilter),
    });
  }

  @Query(() => [StoreProductReviewType])
  @Public()
  async storeReviews(@Args('storeId') storeId: string): Promise<StoreProductReviewType[]> {
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
      imageUrls: input.imageUrls,
    });
    return mapReviewToType(review);
  }

  @Mutation(() => ReviewReplyType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async createReviewReply(
    @CurrentUser('id') userId: string,
    @Args('input') input: CreateReviewReplyInput,
  ): Promise<ReviewReplyType> {
    const reply = await this.reviewsService.createReviewReply({
      userId,
      reviewId: input.reviewId,
      body: input.body,
    });
    return {
      id: reply.id,
      body: reply.body,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
    };
  }

  @Mutation(() => ReviewReplyType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async updateReviewReply(
    @CurrentUser('id') userId: string,
    @Args('input') input: UpdateReviewReplyInput,
  ): Promise<ReviewReplyType> {
    const reply = await this.reviewsService.updateReviewReply({
      userId,
      replyId: input.replyId,
      body: input.body,
    });
    return {
      id: reply.id,
      body: reply.body,
      createdAt: reply.createdAt,
      updatedAt: reply.updatedAt,
    };
  }

  @Query(() => [CustomerReviewableItemType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async customerReviewableItems(
    @CurrentUser('id') customerId: string,
  ): Promise<CustomerReviewableItemType[]> {
    return this.reviewsService.findReviewableItemsForCustomer(customerId);
  }

  @Query(() => [CustomerReviewType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('customer')
  async myReviews(
    @CurrentUser('id') customerId: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit: number,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 }) offset: number,
  ): Promise<CustomerReviewType[]> {
    return this.reviewsService.findMyReviews(customerId, limit, offset);
  }
}
