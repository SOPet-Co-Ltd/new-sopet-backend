import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Store } from '../../database/entities/store.entity';
import { Customer } from '../../database/entities/customer.entity';
import { Dispute } from '../../database/entities/dispute.entity';
import { Product } from '../../database/entities/product.entity';
import { StoreStatus } from '../../database/entities/store.entity';
import { DisputeStatus } from '../../database/entities/dispute.entity';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  const orderRepository = { createQueryBuilder: jest.fn() };
  const orderItemRepository = { createQueryBuilder: jest.fn() };
  const storeRepository = { count: jest.fn() };
  const customerRepository = { count: jest.fn() };
  const disputeRepository = { count: jest.fn() };
  const productRepository = { count: jest.fn() };

  const createOrderItemQb = (raw: Record<string, string>) => ({
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(raw),
    getRawMany: jest.fn().mockResolvedValue([]),
  });

  const createOrderQb = (raw: Record<string, string>) => ({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(raw),
    getRawMany: jest.fn().mockResolvedValue([]),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepository },
        { provide: getRepositoryToken(Store), useValue: storeRepository },
        { provide: getRepositoryToken(Customer), useValue: customerRepository },
        { provide: getRepositoryToken(Dispute), useValue: disputeRepository },
        { provide: getRepositoryToken(Product), useValue: productRepository },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  describe('parseDateRange', () => {
    it('parses from/to dates and sets toDate to end of day', () => {
      const range = service.parseDateRange('2026-01-01', '2026-01-31');

      expect(range.from).toEqual(new Date('2026-01-01'));
      expect(range.to?.getHours()).toBe(23);
      expect(range.to?.getMinutes()).toBe(59);
      expect(range.to?.getSeconds()).toBe(59);
      expect(range.to?.getMilliseconds()).toBe(999);
    });

    it('returns empty range when no dates provided', () => {
      expect(service.parseDateRange()).toEqual({});
      expect(service.parseDateRange(undefined, undefined)).toEqual({});
    });
  });

  describe('getPlatformSalesByPaymentMethod', () => {
    it('formats payment method labels', async () => {
      const qb = createOrderQb({});
      qb.getRawMany.mockResolvedValue([
        { label: 'promptpay', revenue: '1000', orderCount: '5' },
        { label: 'credit_card', revenue: '2000', orderCount: '2' },
        { label: 'cod', revenue: '500', orderCount: '1' },
        { label: 'unknown_method', revenue: '100', orderCount: '1' },
      ]);
      orderRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getPlatformSalesByPaymentMethod();

      expect(result).toEqual([
        { label: 'PromptPay', revenue: 1000, orderCount: 5 },
        { label: 'บัตรเครดิต', revenue: 2000, orderCount: 2 },
        { label: 'เก็บเงินปลายทาง', revenue: 500, orderCount: 1 },
        { label: 'unknown_method', revenue: 100, orderCount: 1 },
      ]);
    });
  });

  describe('getStoreAnalytics', () => {
    it('returns aggregated numbers from query builder results', async () => {
      orderItemRepository.createQueryBuilder
        .mockReturnValueOnce(createOrderItemQb({ count: '42' }))
        .mockReturnValueOnce(createOrderItemQb({ total: '12500.50' }))
        .mockReturnValueOnce(createOrderItemQb({ count: '7' }))
        .mockReturnValueOnce(createOrderItemQb({ count: '3' }));
      productRepository.count.mockResolvedValue(18);

      const result = await service.getStoreAnalytics('store-1');

      expect(result).toEqual({
        totalOrders: 42,
        totalRevenue: 12500.5,
        totalProducts: 18,
        pendingOrders: 7,
        recentOrders: 3,
      });
      expect(productRepository.count).toHaveBeenCalledWith({
        where: { storeId: 'store-1' },
      });
    });
  });

  describe('getPlatformAnalytics', () => {
    it('computes averageOrderValue from totals', async () => {
      const qb = createOrderQb({ count: '10', total: '5000' });
      orderRepository.createQueryBuilder.mockReturnValue(qb);
      storeRepository.count.mockResolvedValueOnce(25).mockResolvedValueOnce(3);
      customerRepository.count.mockResolvedValue(100);
      disputeRepository.count.mockResolvedValue(2);

      const result = await service.getPlatformAnalytics();

      expect(result).toEqual({
        totalOrders: 10,
        totalRevenue: 5000,
        averageOrderValue: 500,
        totalStores: 25,
        pendingStores: 3,
        totalCustomers: 100,
        openDisputes: 2,
      });
      expect(storeRepository.count).toHaveBeenNthCalledWith(1, {
        where: { status: StoreStatus.APPROVED },
      });
      expect(storeRepository.count).toHaveBeenNthCalledWith(2, {
        where: { status: StoreStatus.PENDING },
      });
      expect(disputeRepository.count).toHaveBeenCalledWith({
        where: { status: DisputeStatus.OPEN },
      });
    });

    it('returns zero averageOrderValue when there are no orders', async () => {
      const qb = createOrderQb({ count: '0', total: '0' });
      orderRepository.createQueryBuilder.mockReturnValue(qb);
      storeRepository.count.mockResolvedValue(0);
      customerRepository.count.mockResolvedValue(0);
      disputeRepository.count.mockResolvedValue(0);

      const result = await service.getPlatformAnalytics();

      expect(result.averageOrderValue).toBe(0);
      expect(result.totalOrders).toBe(0);
      expect(result.totalRevenue).toBe(0);
    });
  });

  describe('getProductSoldCounts', () => {
    it('returns counts in input order and zero-fills missing product ids', async () => {
      const qb = createOrderItemQb({});
      qb.getRawMany.mockResolvedValue([
        { productId: 'p1', unitsSold: '5' },
        { productId: 'p3', unitsSold: '12' },
      ]);
      orderItemRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getProductSoldCounts(['p1', 'p2', 'p3']);

      expect(result).toEqual([5, 0, 12]);
      expect(qb.where).toHaveBeenCalledWith('product.id IN (:...productIds)', {
        productIds: ['p1', 'p2', 'p3'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith('o.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: expect.arrayContaining(['cancelled', 'refunded']) as string[],
      });
    });

    it('returns an empty array for empty input', async () => {
      const result = await service.getProductSoldCounts([]);

      expect(result).toEqual([]);
      expect(orderItemRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
