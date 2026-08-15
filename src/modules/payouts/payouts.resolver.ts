import {
  Args,
  Field,
  Float,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PayoutsService } from './payouts.service';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { StoresService } from '../stores/stores.service';
import { PaginationMeta } from '../../graphql/models/types';
import type { PayoutSummary } from './payouts.types';

@ObjectType()
export class PayoutType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field(() => Float)
  amount!: number;

  @Field(() => Float)
  netAmount!: number;

  @Field(() => Float, { nullable: true })
  productSold!: number | null;

  @Field(() => Float, { nullable: true })
  shippingFees!: number | null;

  @Field(() => Float, { nullable: true })
  commissionAmount!: number | null;

  @Field(() => Int, { nullable: true })
  commissionRate!: number | null;

  @Field()
  status!: string;

  @Field()
  settlementRail!: string;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class AdminManualPayoutType {
  @Field()
  id!: string;

  @Field()
  storeId!: string;

  @Field()
  storeName!: string;

  @Field(() => String, { nullable: true })
  bankName!: string | null;

  @Field(() => String, { nullable: true })
  bankCode!: string | null;

  @Field(() => String, { nullable: true })
  bankAccountName!: string | null;

  @Field(() => String, { nullable: true })
  bankAccountNumber!: string | null;

  @Field(() => Float)
  amount!: number;

  @Field(() => Float)
  netAmount!: number;

  @Field(() => Float, { nullable: true })
  productSold!: number | null;

  @Field(() => Float, { nullable: true })
  shippingFees!: number | null;

  @Field(() => Float, { nullable: true })
  commissionAmount!: number | null;

  @Field(() => Int, { nullable: true })
  commissionRate!: number | null;

  @Field()
  status!: string;

  @Field()
  settlementRail!: string;

  @Field()
  createdAt!: Date;
}

@ObjectType()
export class AdminManualPayoutConnection {
  @Field(() => [AdminManualPayoutType])
  items!: AdminManualPayoutType[];

  @Field(() => PaginationMeta)
  pagination!: PaginationMeta;
}

@ObjectType()
export class PayoutRailSummaryType {
  @Field(() => Float)
  grossRevenue!: number;

  @Field(() => Float)
  totalPaidOut!: number;

  @Field(() => Float)
  availableBalance!: number;

  @Field(() => Float)
  productSold!: number;

  @Field(() => Float)
  shippingFees!: number;

  @Field(() => Float)
  commissionAmount!: number;

  @Field(() => Int)
  commissionRate!: number;

  @Field(() => Float)
  pendingPayoutAmount!: number;

  @Field()
  canRequestPayout!: boolean;
}

@ObjectType()
export class PayoutSummaryType {
  @Field()
  storeId!: string;

  /** Omise-rail gross (PromptPay/card). Kept for backward compatibility. */
  @Field(() => Float)
  grossRevenue!: number;

  @Field(() => Float)
  totalPaidOut!: number;

  @Field(() => Float)
  availableBalance!: number;

  @Field(() => Float)
  productSold!: number;

  @Field(() => Float)
  shippingFees!: number;

  @Field(() => Float)
  commissionAmount!: number;

  @Field(() => Int)
  commissionRate!: number;

  @Field(() => Float)
  pendingPayoutAmount!: number;

  @Field(() => Float)
  minimumPayoutAmount!: number;

  @Field()
  canRequestPayout!: boolean;

  @Field(() => PayoutRailSummaryType)
  omise!: PayoutRailSummaryType;

  @Field(() => PayoutRailSummaryType)
  manual!: PayoutRailSummaryType;
}

@InputType()
export class CreatePayoutInput {
  @Field()
  @IsUUID()
  storeId!: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  amount!: number;
}

@InputType()
export class TriggerPayoutInput {
  @Field()
  @IsUUID()
  storeId!: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}

@InputType()
export class SettleManualPayoutInput {
  @Field()
  @IsUUID()
  storeId!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  payoutId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@InputType()
export class RejectManualPayoutInput {
  @Field()
  @IsUUID()
  storeId!: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUUID()
  payoutId?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

@Resolver()
export class PayoutsResolver {
  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => PayoutSummaryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storePayoutSummary(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<PayoutSummaryType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_CONTEXT_REQUIRED',
        message: 'Store context is required',
      });
    }

    await this.storesService.assertStoreOwner(userId, storeId);
    return mapSummary(await this.payoutsService.getPayoutSummary(storeId));
  }

  @Query(() => PayoutSummaryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminStorePayoutSummary(@Args('storeId') storeId: string): Promise<PayoutSummaryType> {
    return mapSummary(await this.payoutsService.getPayoutSummary(storeId));
  }

  @Query(() => [PayoutType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async storePayouts(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<PayoutType[]> {
    await this.storesService.assertStoreOwner(userId, storeId);
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

  @Query(() => AdminManualPayoutConnection)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async pendingManualPayouts(
    @Args('page', { type: () => Int, nullable: true, defaultValue: 1 }) page?: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 20 }) limit?: number,
  ): Promise<AdminManualPayoutConnection> {
    const result = await this.payoutsService.findPendingManualPayouts({ page, limit });
    return {
      items: result.items.map((payout) => ({
        ...mapPayout(payout),
        storeName: payout.store?.name ?? 'ร้านค้า',
        bankName: payout.store?.bankName ?? null,
        bankCode: payout.store?.bankCode ?? null,
        bankAccountName: payout.store?.bankAccountName ?? null,
        bankAccountNumber: payout.store?.bankAccountNumber ?? null,
      })),
      pagination: result.pagination,
    };
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async requestPayout(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<PayoutType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_CONTEXT_REQUIRED',
        message: 'Store context is required',
      });
    }

    await this.storesService.assertStoreOwner(userId, storeId);
    const payout = await this.payoutsService.requestPayout(storeId, userId);
    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor')
  async requestManualPayout(
    @CurrentUser('id') userId: string,
    @CurrentUser('storeId') storeId: string,
  ): Promise<PayoutType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_CONTEXT_REQUIRED',
        message: 'Store context is required',
      });
    }

    await this.storesService.assertStoreOwner(userId, storeId);
    const payout = await this.payoutsService.requestManualPayout(storeId, userId);
    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async triggerPayout(
    @Args('input') input: TriggerPayoutInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<PayoutType> {
    const payout = await this.payoutsService.triggerPayout(input.storeId, {
      amount: input.amount,
      processedBy: adminId,
      bypassMinimum: true,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.PAYOUT_TRIGGERED,
      resourceType: AuditResourceType.PAYOUT,
      resourceId: payout.id,
      metadata: {
        storeId: input.storeId,
        amount: payout.amount,
        settlementRail: payout.settlementRail,
      },
    });

    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async settleManualPayout(
    @Args('input') input: SettleManualPayoutInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<PayoutType> {
    const payout = await this.payoutsService.settleManualPayout(input.storeId, {
      payoutId: input.payoutId,
      processedBy: adminId,
      notes: input.notes,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.PAYOUT_MANUAL_SETTLED,
      resourceType: AuditResourceType.PAYOUT,
      resourceId: payout.id,
      metadata: {
        storeId: input.storeId,
        amount: payout.amount,
        settlementRail: payout.settlementRail,
      },
    });

    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async rejectManualPayout(
    @Args('input') input: RejectManualPayoutInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<PayoutType> {
    const payout = await this.payoutsService.rejectManualPayout(input.storeId, {
      payoutId: input.payoutId,
      processedBy: adminId,
      notes: input.notes,
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.PAYOUT_MANUAL_REJECTED,
      resourceType: AuditResourceType.PAYOUT,
      resourceId: payout.id,
      metadata: {
        storeId: input.storeId,
        amount: payout.amount,
        settlementRail: payout.settlementRail,
      },
    });

    return mapPayout(payout);
  }

  @Mutation(() => PayoutType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createPayout(
    @Args('input') input: CreatePayoutInput,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail?: string,
  ): Promise<PayoutType> {
    const payout = await this.payoutsService.triggerPayout(input.storeId, {
      amount: input.amount,
      processedBy: adminId,
      bypassMinimum: true,
      notes: 'Admin created payout',
    });

    await this.auditLogsService.log({
      actorType: AuditActorType.ADMIN,
      actorId: adminId,
      actorLabel: adminEmail ?? null,
      action: AuditAction.PAYOUT_TRIGGERED,
      resourceType: AuditResourceType.PAYOUT,
      resourceId: payout.id,
      metadata: {
        storeId: input.storeId,
        amount: payout.amount,
        source: 'createPayout',
        settlementRail: payout.settlementRail,
      },
    });

    return mapPayout(payout);
  }
}

function mapSummary(summary: PayoutSummary): PayoutSummaryType {
  return {
    storeId: summary.storeId,
    grossRevenue: summary.grossRevenue,
    totalPaidOut: summary.totalPaidOut,
    availableBalance: summary.availableBalance,
    productSold: summary.productSold,
    shippingFees: summary.shippingFees,
    commissionAmount: summary.commissionAmount,
    commissionRate: summary.commissionRate,
    pendingPayoutAmount: summary.pendingPayoutAmount,
    minimumPayoutAmount: summary.minimumPayoutAmount,
    canRequestPayout: summary.canRequestPayout,
    omise: { ...summary.omise },
    manual: { ...summary.manual },
  };
}

function mapPayout(payout: {
  id: string;
  storeId: string;
  amount: number;
  netAmount: number;
  productSold?: number | null;
  shippingFees?: number | null;
  commissionAmount?: number | null;
  commissionRate?: number | null;
  status: string;
  settlementRail: string;
  createdAt: Date;
}): PayoutType {
  return {
    id: payout.id,
    storeId: payout.storeId,
    amount: Number(payout.amount),
    netAmount: Number(payout.netAmount),
    productSold: payout.productSold == null ? null : Number(payout.productSold),
    shippingFees: payout.shippingFees == null ? null : Number(payout.shippingFees),
    commissionAmount: payout.commissionAmount == null ? null : Number(payout.commissionAmount),
    commissionRate: payout.commissionRate == null ? null : Number(payout.commissionRate),
    status: payout.status,
    settlementRail: payout.settlementRail,
    createdAt: payout.createdAt,
  };
}
