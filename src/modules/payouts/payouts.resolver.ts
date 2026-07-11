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
import { UseGuards } from '@nestjs/common';
import { IsNumber, IsUUID, Min } from 'class-validator';
import { PayoutsService } from './payouts.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

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

@Resolver()
export class PayoutsResolver {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Query(() => [PayoutType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async storePayouts(@CurrentUser('storeId') storeId: string): Promise<PayoutType[]> {
    const payouts = await this.payoutsService.findByStore(storeId);
    return payouts.map(mapPayout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPayout(@Args('input') input: CreatePayoutInput): Promise<PayoutType> {
    const payout = await this.payoutsService.createManualPayout(input.storeId, input.amount);
    return mapPayout(payout);
  }
}

function mapPayout(p: {
  id: string;
  storeId: string;
  amount: number;
  netAmount: number;
  status: string;
}): PayoutType {
  return {
    id: p.id,
    storeId: p.storeId,
    amount: Number(p.amount),
    netAmount: Number(p.netAmount),
    status: p.status,
  };
}
