import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import {
  PlatformAnalyticsType,
  SalesBreakdownItemType,
  SalesTimePointType,
  StoreAnalyticsType,
  TopProductType,
  TopStoreType,
} from '../../graphql/models/types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { StoresService } from '../stores/stores.service';

@Resolver()
export class AnalyticsResolver {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly storesService: StoresService,
  ) {}

  @Query(() => StoreAnalyticsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async storeAnalytics(
    @Args('storeId') storeId: string,
    @Args('fromDate', { nullable: true }) fromDate?: string,
    @Args('toDate', { nullable: true }) toDate?: string,
  ): Promise<StoreAnalyticsType> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_ID_REQUIRED',
        message: 'Store ID is required',
      });
    }
    const range = this.analyticsService.parseDateRange(fromDate, toDate);
    return this.analyticsService.getStoreAnalytics(storeId, range);
  }

  @Query(() => PlatformAnalyticsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformAnalytics(
    @Args('fromDate', { nullable: true }) fromDate?: string,
    @Args('toDate', { nullable: true }) toDate?: string,
  ): Promise<PlatformAnalyticsType> {
    const range = this.analyticsService.parseDateRange(fromDate, toDate);
    return this.analyticsService.getPlatformAnalytics(range);
  }

  @Query(() => [TopProductType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('vendor', 'admin')
  async topProducts(
    @Args('storeId') storeId: string,
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
  ): Promise<TopProductType[]> {
    if (!storeId) {
      throw new BadRequestException({
        code: 'STORE_ID_REQUIRED',
        message: 'Store ID is required',
      });
    }
    return this.analyticsService.getTopProducts(storeId, limit ?? 5);
  }

  @Query(() => [SalesTimePointType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformSalesOverTime(
    @Args('fromDate', { nullable: true }) fromDate?: string,
    @Args('toDate', { nullable: true }) toDate?: string,
  ): Promise<SalesTimePointType[]> {
    const range = this.analyticsService.parseDateRange(fromDate, toDate);
    return this.analyticsService.getPlatformSalesOverTime(range);
  }

  @Query(() => [SalesBreakdownItemType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformSalesByPaymentMethod(
    @Args('fromDate', { nullable: true }) fromDate?: string,
    @Args('toDate', { nullable: true }) toDate?: string,
  ): Promise<SalesBreakdownItemType[]> {
    const range = this.analyticsService.parseDateRange(fromDate, toDate);
    return this.analyticsService.getPlatformSalesByPaymentMethod(range);
  }

  @Query(() => [SalesBreakdownItemType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformSalesByCategory(
    @Args('fromDate', { nullable: true }) fromDate?: string,
    @Args('toDate', { nullable: true }) toDate?: string,
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
  ): Promise<SalesBreakdownItemType[]> {
    const range = this.analyticsService.parseDateRange(fromDate, toDate);
    return this.analyticsService.getPlatformSalesByCategory(range, limit ?? 10);
  }

  @Query(() => [TopProductType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformTopProducts(
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
  ): Promise<TopProductType[]> {
    return this.analyticsService.getPlatformTopProducts(limit ?? 10);
  }

  @Query(() => [TopStoreType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async platformTopStores(
    @Args('limit', { nullable: true, type: () => Int }) limit?: number,
  ): Promise<TopStoreType[]> {
    return this.analyticsService.getPlatformTopStores(limit ?? 10);
  }
}
