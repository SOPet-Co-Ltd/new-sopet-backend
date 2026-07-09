import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { OrderItem, FulfillmentStatus } from '../../database/entities/order-item.entity';
import { Store, StoreStatus } from '../../database/entities/store.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Dispute, DisputeStatus } from '../../database/entities/dispute.entity';
import { Product } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';

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
  openDisputes: number;
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

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(Customer)
    private readonly customerRepository: Repository<Customer>,
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
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

    const pendingStores = await this.storeRepository.count({
      where: { status: StoreStatus.PENDING },
    });

    const totalCustomers = await this.customerRepository.count();

    const openDisputes = await this.disputeRepository.count({
      where: { status: DisputeStatus.OPEN },
    });

    const totalOrders = Number(ordersResult?.count ?? 0);
    const totalRevenue = Number(ordersResult?.total ?? 0);

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      totalStores,
      pendingStores,
      totalCustomers,
      openDisputes,
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

  async getTopProducts(storeId: string, limit = 10): Promise<TopProductResult[]> {
    const rows = await this.orderItemRepository
      .createQueryBuilder('oi')
      .innerJoin('oi.order', 'o')
      .innerJoin('oi.productVariant', 'variant')
      .innerJoin('variant.product', 'product')
      .select('product.id', 'productId')
      .addSelect('product.name', 'name')
      .addSelect('COALESCE(SUM(oi.quantity), 0)', 'unitsSold')
      .addSelect('COALESCE(SUM(oi.subtotal), 0)', 'revenue')
      .where('oi.storeId = :storeId', { storeId })
      .andWhere('o.status NOT IN (:...excludedStatuses)', {
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
