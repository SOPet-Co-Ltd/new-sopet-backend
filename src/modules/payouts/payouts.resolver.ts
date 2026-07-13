import {
  Args,
  Field,
  Float,
  InputType,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';
import { PayoutsService } from './payouts.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../../common/interfaces';

@ObjectType()
export class PayoutType {
  @Field()
  id: string;

  @Field()
  storeId: string;

  @Field(() => Float)
  amount: number;

  @Field(() => Float)
  netAmount: number;

  @Field()
  status: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class PayoutSummaryType {
  @Field()
  storeId: string;

  @Field(() => Float)
  grossRevenue: number;

  @Field(() => Float)
  totalPaidOut: number;

  @Field(() => Float)
  availableBalance: number;

  @Field(() => Float)
  pendingPayoutAmount: number;

  @Field(() => Float)
  minimumPayoutAmount: number;

  @Field()
  canRequestPayout: boolean;
}

@InputType()
export class CreatePayoutInput {
  @Field()
  @IsUUID()
  storeId: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  amount: number;
}

@InputType()
export class TriggerPayoutInput {
  @Field()
  @IsUUID()
  storeId: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

@Resolver()
export class PayoutsResolver {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Query(() => PayoutSummaryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storePayoutSummary(@CurrentUser('storeId') storeId: string): Promise<PayoutSummaryType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_CONTEXT_REQUIRED',
        message: 'Store context is required',
      });
    }

    return this.payoutsService.getPayoutSummary(storeId);
  }

  @Query(() => PayoutSummaryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStorePayoutSummary(@Args('storeId') storeId: string): Promise<PayoutSummaryType> {
    return this.payoutsService.getPayoutSummary(storeId);
  }

  @Query(() => [PayoutType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async storePayouts(@CurrentUser('storeId') storeId: string): Promise<PayoutType[]> {
    const payouts = await this.payoutsService.findByStore(storeId);
    return payouts.map(mapPayout);
  }

  @Query(() => [PayoutType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStorePayouts(@Args('storeId') storeId: string): Promise<PayoutType[]> {
    const payouts = await this.payoutsService.findByStore(storeId);
    return payouts.map(mapPayout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async requestPayout(@CurrentUser() user: JwtPayload): Promise<PayoutType> {
    if (!user.storeId) {
      throw new BadRequestException({
        code: 'STORE_CONTEXT_REQUIRED',
        message: 'Store context is required',
      });
    }

    const payout = await this.payoutsService.requestPayout(user.storeId, user.sub);
    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async triggerPayout(
    @Args('input') input: TriggerPayoutInput,
    @CurrentUser('sub') adminId: string,
  ): Promise<PayoutType> {
    const payout = await this.payoutsService.triggerPayout(input.storeId, {
      amount: input.amount,
      processedBy: adminId,
      bypassMinimum: true,
    });
    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPayout(@Args('input') input: CreatePayoutInput): Promise<PayoutType> {
    const payout = await this.payoutsService.triggerPayout(input.storeId, {
      amount: input.amount,
      bypassMinimum: true,
      notes: 'Admin created payout',
    });
    return mapPayout(payout);
  }
}

function mapPayout(p: {
  id: string;
  storeId: string;
  amount: number;
  netAmount: number;
  status: string;
  createdAt: Date;
}): PayoutType {
  return {
    id: p.id,
    storeId: p.storeId,
    amount: Number(p.amount),
    netAmount: Number(p.netAmount),
    status: p.status,
    createdAt: p.createdAt,
  };
}
