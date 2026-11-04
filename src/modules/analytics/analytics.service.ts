import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../../database/entities/order-item.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { StoreRequest, StoreRequestStatus } from '../../database/entities/store-request.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Product } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import {
  assertSummaryMonthNotBeforeCreatedAt,
  assertValidSummaryMonth,
  bangkokMonthBounds,
  bangkokYearBounds,
  bangkokYearMonthParts,
  computeAverageOrderValue,
  computeOldCustomerShare,
  computePurchasesPerMonth,
  computeRepeatRateLifetimeMonths,
  computeTimeSinceLastPurchase,
  customerCohortLabelTh,
} from './customer-summary.math';

const SUMMARY_EXCLUDED_STATUSES = [
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
  OrderStatus.PENDING_PAYMENT,
];

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface StoreAnalyticsResult {
  totalOrders: number;
  totalRevenue: number;
  totalProducts: number;
  pendingOrders: number;
  recentOrders: number;
}

export interface PlatformAnalyticsResult {
  totalOrders: number;
  totalRevenue: number;
  averageOrderValue: number;
  totalStores: number;
  pendingStores: number;
  totalCustomers: number;
}

export interface SalesTimePointResult {
  date: string;
  revenue: number;
  orderCount: number;
}

export interface SalesBreakdownItemResult {
  label: string;
  revenue: number;
  orderCount: number;
}

export interface TopStoreResult {
  storeId: string;
  storeName: string;
  revenue: number;
  orderCount: number;
}

export interface TopProductResult {
  productId: string;
  name: string;
  unitsSold: number;
  revenue: number;
}

export interface StoreCustomerSummaryResult {
  year: number;
  month: number;
  lifetimeMonths: number | null;
  repeatRate: number | null;
  purchasesPerMonth: number | null;
  averageOrderValue: number | null;
  newCustomerCount: number;
  oldCustomerCount: number;
  oldCustomerPercent: number | null;
  orderCount: number;
  buyersInMonth: number;
  totalCustomers: number;
}

export interface CustomerPurchaseSummaryResult {
  year: number;
  month: number;
  purchasesInMonth: number;
  averageOrderValue: number | null;
  cohortLabel: string;
  cohortLabelTh: string;
  lastOrderAt: Date | null;
  monthsSinceLastOrder: number | null;
  daysSinceLastOrder: number | null;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(StoreRequest)
    private readonly storeRequestRepository: Repository<StoreRequest>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async getStoreAnalytics(storeId: string, range: DateRange = {}): Promise<StoreAnalyticsResult> {
    const orderDateClause = this.buildOrderDateClause(range);

    const totalOrdersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.id)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .getRawOne<{ count: string }>();

    const revenueResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COALESCE(SUM(oi.subtotal), 0)', 'total')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .getRawOne<{ total: string }>();

    const pendingOrdersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.id)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('oi.fulfillmentStatus = :pending', {
        pending: FulfillmentStatus.PENDING,
      })
      .andWhere('o.status IN (:...activeStatuses)', {
        activeStatuses: [OrderStatus.PAID, OrderStatus.PROCESSING],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .getRawOne<{ count: string }>();

    const recentFrom = new Date();
    recentFrom.setDate(recentFrom.getDate() - 7);

    const recentOrdersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.id)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.createdAt >= :recentFrom', { recentFrom })
      .getRawOne<{ count: string }>();

    const totalProducts = await this.productRepository.count({
      where: { storeId },
    });

    return {
      totalOrders: Number(totalOrdersResult?.count ?? 0),
      totalRevenue: Number(revenueResult?.total ?? 0),
      totalProducts,
      pendingOrders: Number(pendingOrdersResult?.count ?? 0),
      recentOrders: Number(recentOrdersResult?.count ?? 0),
    };
  }

  async getPlatformAnalytics(range: DateRange = {}): Promise<PlatformAnalyticsResult> {
    const orderDateClause = this.buildOrderDateClause(range, 'o');

    const ordersResult = await this.orderRepository
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'count')
      .addSelect('COALESCE(SUM(o.total), 0)', 'total')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .getRawOne<{ count: string; total: string }>();

    const totalStores = await this.storeRepository.count({
      where: { status: StoreStatus.APPROVED },
    });

    // Vendor onboarding creates a StoreRequest first; the Store row itself is
    // only created (as APPROVED) once an admin approves the request, so
    // pending approvals must be counted from StoreRequest, not Store.
    const pendingStores = await this.storeRequestRepository.count({
      where: { status: StoreRequestStatus.PENDING },
    });

    const totalCustomers = await this.customerRepository.count();

    const totalOrders = Number(ordersResult?.count ?? 0);
    const totalRevenue = Number(ordersResult?.total ?? 0);

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      totalStores,
      pendingStores,
      totalCustomers,
    };
  }

  async getPlatformSalesOverTime(range: DateRange = {}): Promise<SalesTimePointResult[]> {
    const effectiveRange = this.resolveChartRange(range);
    const orderDateClause = this.buildOrderDateClause(effectiveRange, 'o');

    const rows = await this.orderRepository
      .createQueryBuilder('o')
      .select("TO_CHAR(o.createdAt, 'YYYY-MM-DD')", 'date')
      .addSelect('COALESCE(SUM(o.total), 0)', 'revenue')
      .addSelect('COUNT(o.id)', 'orderCount')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .groupBy("TO_CHAR(o.createdAt, 'YYYY-MM-DD')")
      .orderBy('date', 'ASC')
      .getRawMany<{ date: string; revenue: string; orderCount: string }>();

    return rows.map((row) => ({
      date: row.date,
      revenue: Number(row.revenue),
      orderCount: Number(row.orderCount),
    }));
  }

  async getPlatformSalesByPaymentMethod(
    range: DateRange = {},
  ): Promise<SalesBreakdownItemResult[]> {
    const orderDateClause = this.buildOrderDateClause(range, 'o');

    const rows = await this.orderRepository
      .createQueryBuilder('o')
      .select('o.paymentMethod', 'label')
      .addSelect('COALESCE(SUM(o.total), 0)', 'revenue')
      .addSelect('COUNT(o.id)', 'orderCount')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .groupBy('o.paymentMethod')
      .orderBy('revenue', 'DESC')
      .getRawMany<{ label: string; revenue: string; orderCount: string }>();

    return rows.map((row) => ({
      label: this.formatPaymentMethodLabel(row.label),
      revenue: Number(row.revenue),
      orderCount: Number(row.orderCount),
    }));
  }

  async getPlatformSalesByCategory(
    range: DateRange = {},
    limit = 10,
  ): Promise<SalesBreakdownItemResult[]> {
    const orderDateClause = this.buildOrderDateClause(range, 'o');

    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('oi.productVariant', 'variant')
      .innerJoin('variant.product', 'product')
      .leftJoin('product.categoryRelation', 'category')
      .select("COALESCE(category.name, 'ไม่ระบุหมวดหมู่')", 'label')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .addSelect('COUNT(DISTINCT o.id)', 'orderCount')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .andWhere(orderDateClause.clause, orderDateClause.params)
      .groupBy('category.name')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany<{ label: string; revenue: string; orderCount: string }>();

    return rows.map((row) => ({
      label: row.label,
      revenue: Number(row.revenue),
      orderCount: Number(row.orderCount),
    }));
  }

  async getPlatformTopProducts(limit = 10): Promise<TopProductResult[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('oi.productVariant', 'variant')
      .innerJoin('variant.product', 'product')
      .select('product.id', 'productId')
      .addSelect('product.name', 'name')
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'unitsSold')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .groupBy('product.id')
      .addGroupBy('product.name')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany<{
        productId: string;
        name: string;
        unitsSold: string;
        revenue: string;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      unitsSold: Number(row.unitsSold),
      revenue: Number(row.revenue),
    }));
  }

  async getProductSoldCounts(productIds: string[]): Promise<number[]> {
    if (productIds.length === 0) {
      return [];
    }

    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('oi.productVariant', 'variant')
      .innerJoin('variant.product', 'product')
      .select('product.id', 'productId')
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'unitsSold')
      .where('product.id IN (:...productIds)', { productIds })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .groupBy('product.id')
      .getRawMany<{ productId: string; unitsSold: string }>();

    const countByProductId = new Map(rows.map((row) => [row.productId, Number(row.unitsSold)]));

    return productIds.map((productId) => countByProductId.get(productId) ?? 0);
  }

  async getPlatformTopStores(limit = 10): Promise<TopStoreResult[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('oi.store', 'store')
      .select('store.id', 'storeId')
      .addSelect('store.name', 'storeName')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .addSelect('COUNT(DISTINCT o.id)', 'orderCount')
      .where('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .groupBy('store.id')
      .addGroupBy('store.name')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany<{
        storeId: string;
        storeName: string;
        revenue: string;
        orderCount: string;
      }>();

    return rows.map((row) => ({
      storeId: row.storeId,
      storeName: row.storeName,
      revenue: Number(row.revenue),
      orderCount: Number(row.orderCount),
    }));
  }

  async getStoreCustomerSummary(
    storeId: string,
    year: number,
    month: number,
    now: Date = new Date(),
  ): Promise<StoreCustomerSummaryResult> {
    this.assertSummaryMonthOrThrow(year, month, now);

    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({
        code: 'STORE_NOT_FOUND',
        message: 'Store not found',
      });
    }
    this.assertSummaryMonthNotBeforeCreatedOrThrow(year, month, store.createdAt);

    const { from: monthFrom, to: monthTo } = bangkokMonthBounds(year, month);
    const priorYear = year - 1;
    const { year: nowYear } = bangkokYearMonthParts(now);
    const selectedYearEndCap = year === nowYear ? now : undefined;
    const priorYearBounds = bangkokYearBounds(priorYear);
    const selectedYearBounds = bangkokYearBounds(year, selectedYearEndCap);

    const monthStats = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.id)', 'orderCount')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .addSelect('COUNT(DISTINCT o.customerId)', 'buyersInMonth')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt >= :monthFrom', { monthFrom })
      .andWhere('o.createdAt <= :monthTo', { monthTo })
      .getRawOne<{ orderCount: string; revenue: string; buyersInMonth: string }>();

    const orderCount = Number(monthStats?.orderCount ?? 0);
    const revenue = Number(monthStats?.revenue ?? 0);
    const buyersInMonth = Number(monthStats?.buyersInMonth ?? 0);

    const totalCustomersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.customerId)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt <= :monthTo', { monthTo })
      .getRawOne<{ count: string }>();

    const totalCustomers = Number(totalCustomersResult?.count ?? 0);

    const newCustomerResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('o.customerId', 'customerId')
      .addSelect('MIN(o.createdAt)', 'firstAt')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt <= :monthTo', { monthTo })
      .groupBy('o.customerId')
      .having('MIN(o.createdAt) >= :monthFrom', { monthFrom })
      .getRawMany<{ customerId: string; firstAt: Date }>();

    const newCustomerCount = newCustomerResult.length;

    const oldCustomerResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('o.customerId', 'customerId')
      .distinct(true)
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt >= :monthFrom', { monthFrom })
      .andWhere('o.createdAt <= :monthTo', { monthTo })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM order_items oi2
          INNER JOIN orders o2 ON o2.id = oi2.order_id
          WHERE oi2.store_id = :storeId
            AND o2.customer_id = o.customer_id
            AND o2.customer_id IS NOT NULL
            AND o2.status NOT IN (:...excludedStatuses)
            AND o2.created_at < :monthFrom
        )`,
      )
      .getRawMany<{ customerId: string }>();

    const oldCustomerCount = oldCustomerResult.length;
    const { oldCustomerPercent } = computeOldCustomerShare(oldCustomerCount, buyersInMonth);

    const priorYearBuyersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.customerId)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt >= :from', { from: priorYearBounds.from })
      .andWhere('o.createdAt <= :to', { to: priorYearBounds.to })
      .getRawOne<{ count: string }>();

    const priorYearBuyers = Number(priorYearBuyersResult?.count ?? 0);

    const returningBuyersResult = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .select('COUNT(DISTINCT o.customerId)', 'count')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.customerId IS NOT NULL')
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt >= :selectedFrom', { selectedFrom: selectedYearBounds.from })
      .andWhere('o.createdAt <= :selectedTo', { selectedTo: selectedYearBounds.to })
      .andWhere(
        `EXISTS (
          SELECT 1 FROM order_items oi2
          INNER JOIN orders o2 ON o2.id = oi2.order_id
          WHERE oi2.store_id = :storeId
            AND o2.customer_id = o.customer_id
            AND o2.customer_id IS NOT NULL
            AND o2.status NOT IN (:...excludedStatuses)
            AND o2.created_at >= :priorFrom
            AND o2.created_at <= :priorTo
        )`,
        { priorFrom: priorYearBounds.from, priorTo: priorYearBounds.to },
      )
      .getRawOne<{ count: string }>();

    const returningBuyers = Number(returningBuyersResult?.count ?? 0);
    const { repeatRate, lifetimeMonths } = computeRepeatRateLifetimeMonths(
      priorYearBuyers,
      returningBuyers,
    );

    return {
      year,
      month,
      lifetimeMonths,
      repeatRate,
      purchasesPerMonth: computePurchasesPerMonth(orderCount, totalCustomers),
      averageOrderValue: computeAverageOrderValue(revenue, orderCount),
      newCustomerCount,
      oldCustomerCount,
      oldCustomerPercent,
      orderCount,
      buyersInMonth,
      totalCustomers,
    };
  }

  async getCustomerPurchaseSummary(
    customerId: string,
    year: number,
    month: number,
    now: Date = new Date(),
  ): Promise<CustomerPurchaseSummaryResult> {
    this.assertSummaryMonthOrThrow(year, month, now);

    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer) {
      throw new NotFoundException({
        code: 'CUSTOMER_NOT_FOUND',
        message: 'Customer not found',
      });
    }
    this.assertSummaryMonthNotBeforeCreatedOrThrow(year, month, customer.createdAt);

    const { from: monthFrom, to: monthTo } = bangkokMonthBounds(year, month);

    // Lifetime facts (ignore selected month): last-order recency vs now, and
    // new/old from total qualifying orders.
    const lifetimeStats = await this.orderRepository
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'orderCount')
      .addSelect('MAX(o.createdAt)', 'lastAt')
      .where('o.customerId = :customerId', { customerId })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .getRawOne<{ orderCount: string; lastAt: Date | null }>();

    const lifetimeOrderCount = Number(lifetimeStats?.orderCount ?? 0);
    const lastOrderAt = lifetimeStats?.lastAt ? new Date(lifetimeStats.lastAt) : null;
    const sinceLast = lastOrderAt ? computeTimeSinceLastPurchase(lastOrderAt, now) : null;

    let cohortLabel: 'new' | 'old' | 'never' = 'never';
    if (lifetimeOrderCount === 1) {
      cohortLabel = 'new';
    } else if (lifetimeOrderCount >= 2) {
      cohortLabel = 'old';
    }

    const monthStats = await this.orderRepository
      .createQueryBuilder('o')
      .select('COUNT(o.id)', 'orderCount')
      .addSelect('COALESCE(SUM(o.total), 0)', 'revenue')
      .where('o.customerId = :customerId', { customerId })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: SUMMARY_EXCLUDED_STATUSES,
      })
      .andWhere('o.createdAt >= :monthFrom', { monthFrom })
      .andWhere('o.createdAt <= :monthTo', { monthTo })
      .getRawOne<{ orderCount: string; revenue: string }>();

    const purchasesInMonth = Number(monthStats?.orderCount ?? 0);
    const revenue = Number(monthStats?.revenue ?? 0);

    return {
      year,
      month,
      purchasesInMonth,
      averageOrderValue: computeAverageOrderValue(revenue, purchasesInMonth),
      cohortLabel,
      cohortLabelTh: customerCohortLabelTh(cohortLabel),
      lastOrderAt,
      monthsSinceLastOrder: sinceLast?.months ?? null,
      daysSinceLastOrder: sinceLast?.days ?? null,
    };
  }

  parseDateRange(fromDate?: string, toDate?: string): DateRange {
    const range: DateRange = {};

    if (fromDate) {
      range.from = new Date(fromDate);
    }
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      range.to = to;
    }

    return range;
  }

  private assertSummaryMonthOrThrow(year: number, month: number, now: Date): void {
    try {
      assertValidSummaryMonth(year, month, now);
    } catch (error) {
      const code =
        error instanceof Error && error.message.startsWith('SUMMARY_')
          ? error.message
          : error instanceof Error && error.message.startsWith('INVALID_')
            ? error.message
            : 'INVALID_SUMMARY_MONTH';
      throw new BadRequestException({
        code,
        message: 'Invalid summary year/month',
      });
    }
  }

  private assertSummaryMonthNotBeforeCreatedOrThrow(
    year: number,
    month: number,
    createdAt: Date,
  ): void {
    try {
      assertSummaryMonthNotBeforeCreatedAt(year, month, createdAt);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'SUMMARY_MONTH_BEFORE_CREATED';
      throw new BadRequestException({
        code,
        message: 'Summary month is before account/store creation',
      });
    }
  }

  async getTopProducts(storeId: string, limit = 10): Promise<TopProductResult[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('product_variants', 'variant', 'variant.id = oi.variant_id')
      .leftJoin('products', 'product', 'product.id = variant.product_id')
      .select('variant.product_id', 'productId')
      .addSelect('COALESCE(MAX(product.name), MAX(oi.product_name))', 'name')
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'unitsSold')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
      })
      .groupBy('variant.product_id')
      .orderBy('revenue', 'DESC')
      .limit(limit)
      .getRawMany<{
        productId: string;
        name: string;
        unitsSold: string;
        revenue: string;
      }>();

    return rows.map((row) => ({
      productId: row.productId,
      name: row.name,
      unitsSold: Number(row.unitsSold),
      revenue: Number(row.revenue),
    }));
  }

  private resolveChartRange(range: DateRange): DateRange {
    if (range.from || range.to) {
      return range;
    }

    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    from.setHours(0, 0, 0, 0);

    return { from, to };
  }

  private formatPaymentMethodLabel(method: string): string {
    const labels: Record<string, string> = {
      promptpay: 'PromptPay',
      credit_card: 'บัตรเครดิต',
      cod: 'เก็บเงินปลายทาง',
      bank_transfer: 'โอนเงินเข้าบัญชี',
    };

    return labels[method] ?? method;
  }

  private buildOrderDateClause(
    range: DateRange,
    alias = 'o',
  ): { clause: string; params: Record<string, Date> } {
    const params: Record<string, Date> = {};
    const clauses: string[] = ['1=1'];

    if (range.from) {
      clauses.push(`${alias}.createdAt >= :fromDate`);
      params.fromDate = range.from;
    }
    if (range.to) {
      clauses.push(`${alias}.createdAt <= :toDate`);
      params.toDate = range.to;
    }

    return {
      clause: clauses.join(' AND '),
      params,
    };
  }
}
