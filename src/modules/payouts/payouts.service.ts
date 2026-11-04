import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { PaginatedResponse } from '../../common/interfaces';
import {
  buildAdminListPagination,
  normalizeAdminListLimit,
  normalizeAdminListPage,
} from '../../common/utils/admin-list-pagination.util';
import { Payout, PayoutSettlementRail, PayoutStatus } from '../../database/entities/payout.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { DataSource as OrderDataSource } from '../../database/entities/enums/data-source.enums';
import { Store } from '../../database/entities/store.entity';
import { Promotion, PromotionScope } from '../../database/entities/promotion.entity';
import { PromotionUsage } from '../../database/entities/promotion-usage.entity';
import { OrderStoreShipping } from '../../database/entities/order-store-shipping.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DashboardEventsService } from '../dashboard-events/dashboard-events.service';
import { DashboardActivityKind } from '../dashboard-events/dashboard-activity.constants';
import { DEFAULT_COMMISSION_RATE_PERCENT } from '../../config/commission.config';
import {
  commissionSatang,
  consumePriorPayouts,
  consumeToAmount,
  effectiveRate,
  finalizeBreakdown,
  unpaidShippingForRemainingProduct,
  type Breakdown,
  type PriorPayout,
  type UnpaidBuckets,
} from './payout-commission.calculator';
import {
  CreatePayoutOptions,
  PayoutSummary,
  RejectManualPayoutOptions,
  SettleManualPayoutOptions,
  TriggerPayoutOptions,
} from './payouts.types';

const PAID_OUT_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING, PayoutStatus.COMPLETED];
const PENDING_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING];

/**
 * Single manual settlement rail: every online method (PSP-collected) plus bank_transfer.
 * COD is excluded. Admin transfers funds offline then calls settleManualPayout.
 */
const MANUAL_RAIL_PAYMENT_METHODS = [
  PaymentMethod.PROMPTPAY,
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.TRUEMONEY,
  PaymentMethod.SHOPEEPAY,
  PaymentMethod.BANK_TRANSFER,
];

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @InjectRepository(Payout)
    private readonly payoutRepository: Repository<Payout>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly dashboardEventsService: DashboardEventsService,
  ) {}

  async findByStore(
    storeId: string,
    params: { page?: number; limit?: number } = {},
  ): Promise<PaginatedResponse<Payout>> {
    const page = normalizeAdminListPage(params.page);
    const limit = normalizeAdminListLimit(params.limit);
    const [items, total] = await this.payoutRepository.findAndCount({
      where: { storeId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items,
      pagination: buildAdminListPagination(page, limit, total),
    };
  }

  async findPendingManualPayouts(params: { page?: number; limit?: number }): Promise<{
    items: Payout[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));

    const [items, total] = await this.payoutRepository.findAndCount({
      where: {
        settlementRail: PayoutSettlementRail.MANUAL,
        status: PayoutStatus.PENDING,
      },
      relations: ['store'],
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getPayoutSummary(storeId: string): Promise<PayoutSummary> {
    const store = await this.findStoreOrThrow(storeId);

    const [unpaid, totalPaidOut, pendingPayoutAmount] = await Promise.all([
      this.computeUnpaidBreakdown(storeId, MANUAL_RAIL_PAYMENT_METHODS),
      this.calculateTotalPaidOut(storeId),
      this.calculatePendingPayoutAmount(storeId),
    ]);

    const availableBalance = Math.max(0, unpaid.net);
    const minimumPayoutAmount = this.getMinimumPayoutAmount();
    const canRequestPayout =
      this.hasCompleteBankAccount(store) &&
      pendingPayoutAmount <= 0 &&
      availableBalance > 0 &&
      availableBalance >= minimumPayoutAmount;

    return {
      storeId,
      grossRevenue: unpaid.lifetimeProduct,
      totalPaidOut,
      availableBalance,
      productSold: unpaid.productSold,
      shippingFees: unpaid.shippingFees,
      commissionAmount: unpaid.commissionAmount,
      commissionRate: unpaid.commissionRate,
      pendingPayoutAmount,
      minimumPayoutAmount,
      canRequestPayout,
    };
  }

  async getAvailableBalance(storeId: string): Promise<number> {
    const summary = await this.getPayoutSummary(storeId);
    return summary.availableBalance;
  }

  /**
   * Vendor requests settlement of all accrued revenue (single manual rail).
   * Requires a saved bank account. Creates a PENDING payout; admin transfers
   * offline then calls settleManualPayout.
   */
  async requestPayout(storeId: string, processedBy?: string): Promise<Payout> {
    const store = await this.findStoreOrThrow(storeId);

    if (!this.hasCompleteBankAccount(store)) {
      throw new BadRequestException({
        code: 'BANK_ACCOUNT_REQUIRED',
        message: 'Bank account details must be saved before requesting a payout',
      });
    }

    const summary = await this.getPayoutSummary(storeId);

    if (summary.pendingPayoutAmount > 0) {
      throw new BadRequestException({
        code: 'PAYOUT_ALREADY_PENDING',
        message: 'A payout is already pending for this store',
      });
    }

    if (summary.availableBalance <= 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'No funds available for payout',
      });
    }

    if (summary.availableBalance < summary.minimumPayoutAmount) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `Minimum payout amount is ${summary.minimumPayoutAmount}`,
      });
    }

    const payout = await this.createManualPayout(storeId, summary.availableBalance, {
      processedBy,
      notes: 'Vendor requested payout',
    });

    try {
      await this.notificationsService.notifyAdminsAboutManualPayoutRequest({
        payoutId: payout.id,
        storeId,
        storeName: store.name,
        amount: Number(payout.amount),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to notify admins about manual payout ${payout.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    void this.dashboardEventsService.publish({
      kind: DashboardActivityKind.PAYOUT,
      entityId: payout.id,
      storeId,
      userIds: store.ownerId ? [store.ownerId] : undefined,
      roles: ['admin'],
    });

    return payout;
  }

  /** Admin-created pending payout on the manual rail. */
  async triggerPayout(storeId: string, options: TriggerPayoutOptions = {}): Promise<Payout> {
    const summary = await this.getPayoutSummary(storeId);
    const amount = options.amount ?? summary.availableBalance;

    if (amount <= 0) {
      throw new BadRequestException({
        code: 'INVALID_PAYOUT_AMOUNT',
        message: 'Payout amount must be greater than zero',
      });
    }

    if (amount > summary.availableBalance) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Payout amount exceeds available balance',
      });
    }

    if (!options.bypassMinimum && amount < summary.minimumPayoutAmount) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `Minimum payout amount is ${summary.minimumPayoutAmount}`,
      });
    }

    return this.createManualPayout(storeId, amount, {
      processedBy: options.processedBy,
      notes: options.notes ?? 'Admin triggered payout',
    });
  }

  /** Alias of requestPayout (single manual rail). */
  async requestManualPayout(storeId: string, processedBy?: string): Promise<Payout> {
    return this.requestPayout(storeId, processedBy);
  }

  /**
   * Admin approves a pending manual payout after transferring funds outside Omise.
   */
  async settleManualPayout(
    storeId: string,
    options: SettleManualPayoutOptions = {},
  ): Promise<Payout> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    const pending = await this.resolvePendingManualPayout(storeId, options.payoutId);
    const now = new Date();

    const payout = await this.dataSource.transaction(async (manager) => {
      await this.lockStoreRowForPayout(manager, storeId);

      const locked = await manager
        .getRepository(Payout)
        .createQueryBuilder('payout')
        .where('payout.id = :id', { id: pending.id })
        .setLock('pessimistic_write')
        .getOne();
      if (!locked || locked.status !== PayoutStatus.PENDING) {
        throw new BadRequestException({
          code: 'PAYOUT_NOT_PENDING',
          message: 'Manual payout is no longer pending',
        });
      }
      if (locked.storeId !== storeId || locked.settlementRail !== PayoutSettlementRail.MANUAL) {
        throw new BadRequestException({
          code: 'PAYOUT_MISMATCH',
          message: 'Payout does not belong to this store manual rail',
        });
      }

      locked.status = PayoutStatus.COMPLETED;
      locked.processedBy = options.processedBy ?? locked.processedBy;
      locked.processedAt = now;
      locked.notes = options.notes ?? locked.notes ?? 'Admin approved manual payout after transfer';
      return manager.getRepository(Payout).save(locked);
    });

    void this.dashboardEventsService.publish({
      kind: DashboardActivityKind.PAYOUT,
      entityId: payout.id,
      storeId,
      userIds: store.ownerId ? [store.ownerId] : undefined,
      roles: ['admin'],
    });

    return payout;
  }

  /**
   * Admin rejects a pending manual payout (vendor may request again).
   */
  async rejectManualPayout(
    storeId: string,
    options: RejectManualPayoutOptions = {},
  ): Promise<Payout> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    const pending = await this.resolvePendingManualPayout(storeId, options.payoutId);
    const now = new Date();

    const payout = await this.dataSource.transaction(async (manager) => {
      await this.lockStoreRowForPayout(manager, storeId);

      const locked = await manager
        .getRepository(Payout)
        .createQueryBuilder('payout')
        .where('payout.id = :id', { id: pending.id })
        .setLock('pessimistic_write')
        .getOne();
      if (!locked || locked.status !== PayoutStatus.PENDING) {
        throw new BadRequestException({
          code: 'PAYOUT_NOT_PENDING',
          message: 'Manual payout is no longer pending',
        });
      }
      if (locked.storeId !== storeId || locked.settlementRail !== PayoutSettlementRail.MANUAL) {
        throw new BadRequestException({
          code: 'PAYOUT_MISMATCH',
          message: 'Payout does not belong to this store manual rail',
        });
      }

      locked.status = PayoutStatus.FAILED;
      locked.processedBy = options.processedBy ?? locked.processedBy;
      locked.processedAt = now;
      locked.failureReason = options.notes ?? 'Admin rejected manual payout request';
      locked.notes = options.notes ?? locked.notes;
      return manager.getRepository(Payout).save(locked);
    });

    void this.dashboardEventsService.publish({
      kind: DashboardActivityKind.PAYOUT,
      entityId: payout.id,
      storeId,
      userIds: store.ownerId ? [store.ownerId] : undefined,
      roles: ['admin'],
    });

    return payout;
  }

  private async resolvePendingManualPayout(storeId: string, payoutId?: string): Promise<Payout> {
    if (payoutId) {
      const payout = await this.payoutRepository.findOne({ where: { id: payoutId } });
      if (!payout) {
        throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });
      }
      if (payout.storeId !== storeId) {
        throw new BadRequestException({
          code: 'PAYOUT_MISMATCH',
          message: 'Payout does not belong to this store',
        });
      }
      if (payout.settlementRail !== PayoutSettlementRail.MANUAL) {
        throw new BadRequestException({
          code: 'PAYOUT_WRONG_RAIL',
          message: 'Payout is not on the manual settlement rail',
        });
      }
      if (payout.status !== PayoutStatus.PENDING) {
        throw new BadRequestException({
          code: 'PAYOUT_NOT_PENDING',
          message: 'Manual payout is not pending',
        });
      }
      return payout;
    }

    const pending = await this.payoutRepository.findOne({
      where: {
        storeId,
        settlementRail: PayoutSettlementRail.MANUAL,
        status: PayoutStatus.PENDING,
      },
      order: { createdAt: 'ASC' },
    });
    if (!pending) {
      throw new BadRequestException({
        code: 'NO_PENDING_MANUAL_PAYOUT',
        message: 'No pending manual payout request for this store — vendor must request first',
      });
    }
    return pending;
  }

  async createManualPayout(
    storeId: string,
    amount: number,
    options: CreatePayoutOptions = {},
  ): Promise<Payout> {
    await this.assertStoreExists(storeId);

    // requestPayout (vendor) and triggerPayout (admin) read the pending-payout summary and
    // only create a payout if it's zero, with no lock in between - two concurrent calls
    // can otherwise both pass that check and each create a PENDING payout for the same
    // balance. Locking the store row inside a transaction serializes concurrent creates for
    // the same store; the recheck after acquiring the lock is what catches the race.
    return this.dataSource.transaction(async (manager) => {
      await this.lockStoreRowForPayout(manager, storeId);
      await this.assertNoConcurrentPendingPayout(manager, storeId);
      return this.insertSnapshotPayout(manager, {
        storeId,
        rail: PayoutSettlementRail.MANUAL,
        paymentMethods: MANUAL_RAIL_PAYMENT_METHODS,
        amount,
        processedBy: options.processedBy ?? null,
        notes: options.notes ?? null,
      });
    });
  }

  private async lockStoreRowForPayout(manager: EntityManager, storeId: string): Promise<void> {
    const store = await manager
      .getRepository(Store)
      .createQueryBuilder('store')
      .where('store.id = :storeId', { storeId })
      .setLock('pessimistic_write')
      .getOne();

    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }
  }

  private async assertNoConcurrentPendingPayout(
    manager: EntityManager,
    storeId: string,
  ): Promise<void> {
    const pending = await manager.getRepository(Payout).findOne({
      where: { storeId, status: In(PENDING_STATUSES) },
    });

    if (pending) {
      throw new BadRequestException({
        code: 'PAYOUT_ALREADY_PENDING',
        message: 'A payout is already pending for this store',
      });
    }
  }

  /**
   * Unpaid-bucket fours + derived net using the shared calculator.
   * Eligibility (hold / rail / status) first; cutoff split second.
   * Does not persist snapshot columns.
   */
  async computeUnpaidBreakdown(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<Breakdown & { lifetimeProduct: number; unpaid: UnpaidBuckets }> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    const goLiveAt = this.configService.get<Date>('commission.goLiveAt');
    const rate = effectiveRate(
      store.commissionRate ?? null,
      this.configService.get<number>('commission.defaultRatePercent') ??
        DEFAULT_COMMISSION_RATE_PERCENT,
    );

    const { preProduct, postProduct } = await this.calculateEligibleProductBuckets(
      storeId,
      paymentMethods,
      goLiveAt,
    );
    const orderSlices = await this.listEligibleOrderSlices(storeId, paymentMethods);
    const priorPayouts = await this.loadPriorPayoutsForConsume(storeId);
    const unpaid = consumePriorPayouts({ preProduct, postProduct, postShipping: 0 }, priorPayouts);
    unpaid.unpaidShip = unpaidShippingForRemainingProduct(
      orderSlices,
      unpaid.unpaidPre + unpaid.unpaidPost,
    );
    const breakdown = finalizeBreakdown(unpaid, rate);

    return {
      ...breakdown,
      lifetimeProduct: preProduct + postProduct,
      unpaid,
    };
  }

  /**
   * Persist snapshot columns in the same insert as amount/net. Both rails.
   * Omit `amount` to consume the full unpaid net.
   */
  private async insertSnapshotPayout(
    manager: EntityManager,
    params: {
      storeId: string;
      rail: PayoutSettlementRail;
      paymentMethods: PaymentMethod[];
      amount?: number;
      processedBy?: string | null;
      notes?: string | null;
    },
  ): Promise<Payout> {
    const unpaidFull = await this.computeUnpaidBreakdown(params.storeId, params.paymentMethods);
    const requested = params.amount ?? unpaidFull.net;

    if (requested <= 0) {
      throw new BadRequestException({
        code: 'INVALID_PAYOUT_AMOUNT',
        message: 'Payout amount must be greater than zero',
      });
    }
    if (requested > unpaidFull.net) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Payout amount exceeds available balance',
      });
    }

    const breakdown = consumeToAmount(unpaidFull.unpaid, requested, unpaidFull.commissionRate);
    this.assertCommissionFormula(breakdown, unpaidFull.unpaid, unpaidFull.commissionRate);

    const created = manager.getRepository(Payout).create({
      storeId: params.storeId,
      amount: breakdown.net,
      fee: 0,
      netAmount: breakdown.net,
      commissionRate: breakdown.commissionRate,
      productSold: breakdown.productSold,
      shippingFees: breakdown.shippingFees,
      commissionAmount: breakdown.commissionAmount,
      status: PayoutStatus.PENDING,
      settlementRail: params.rail,
      transferReference: null,
      processedBy: params.processedBy ?? null,
      processedAt: null,
      notes: params.notes ?? null,
    });
    const payout = await manager.getRepository(Payout).save(created);

    const requestedSatang = Math.floor(requested * 100 + 0.5);
    this.logCreateSnapshot(payout, {
      partialConsume: requestedSatang < Math.floor(unpaidFull.net * 100 + 0.5),
      requestedAmount: requested,
    });

    return payout;
  }

  private assertCommissionFormula(breakdown: Breakdown, unpaid: UnpaidBuckets, rate: number): void {
    const productSatang = Math.floor(breakdown.productSold * 100 + 0.5);
    const unpaidPreSatang = Math.floor(unpaid.unpaidPre * 100 + 0.5);
    const consumedPostSatang = Math.max(0, productSatang - unpaidPreSatang);
    const expectedSatang = commissionSatang(consumedPostSatang, rate);
    const actualSatang = Math.floor(breakdown.commissionAmount * 100 + 0.5);
    if (actualSatang !== expectedSatang) {
      this.logger.error(
        `Commission formula mismatch store snapshot productSold=${breakdown.productSold} ` +
          `commissionAmount=${breakdown.commissionAmount} expectedSatang=${expectedSatang} ` +
          `rate=${rate} consumedPostSatang=${consumedPostSatang}`,
      );
      throw new BadRequestException({
        code: 'COMMISSION_FORMULA_MISMATCH',
        message: 'Commission amount does not match round_half_up(post × rate / 100)',
      });
    }
  }

  private logCreateSnapshot(
    payout: Payout,
    extras: {
      partialConsume: boolean;
      requestedAmount?: number;
    },
  ): void {
    const partialNote = extras.partialConsume
      ? ` partialConsume=true requestedAmount=${extras.requestedAmount}`
      : '';
    this.logger.log(
      `Payout snapshot created storeId=${payout.storeId} payoutId=${payout.id} ` +
        `productSold=${payout.productSold} shippingFees=${payout.shippingFees} ` +
        `commissionAmount=${payout.commissionAmount} commissionRate=${payout.commissionRate} ` +
        `net=${payout.netAmount}${partialNote}`,
    );
  }

  private async calculateEligibleProductBuckets(
    storeId: string,
    paymentMethods: PaymentMethod[],
    goLiveAt: Date | undefined,
  ): Promise<{ preProduct: number; postProduct: number }> {
    if (!goLiveAt) {
      const [itemSubtotal, storePromotionDiscounts] = await Promise.all([
        this.calculateItemSubtotal(storeId, paymentMethods),
        this.calculateStorePromotionDiscounts(storeId, paymentMethods),
      ]);
      return {
        preProduct: 0,
        postProduct: Math.max(0, itemSubtotal - storePromotionDiscounts),
      };
    }

    const [preItems, postItems, prePromos, postPromos] = await Promise.all([
      this.sumEligibleItemSubtotal(storeId, paymentMethods, 'pre', goLiveAt),
      this.sumEligibleItemSubtotal(storeId, paymentMethods, 'post', goLiveAt),
      this.sumStorePromotionDiscounts(storeId, paymentMethods, 'pre', goLiveAt),
      this.sumStorePromotionDiscounts(storeId, paymentMethods, 'post', goLiveAt),
    ]);

    return {
      preProduct: Math.max(0, preItems - prePromos),
      postProduct: Math.max(0, postItems - postPromos),
    };
  }

  private eligibleItemsQuery(storeId: string, paymentMethods: PaymentMethod[]) {
    return (
      this.orderItemRepository
        .createQueryBuilder('item')
        .innerJoin(Order, 'order', 'order.id = item.order_id')
        .where('item.store_id = :storeId', { storeId })
        .andWhere('order.status IN (:...statuses)', {
          statuses: [OrderStatus.PAID, OrderStatus.DELIVERED],
        })
        .andWhere('order.payment_method IN (:...paymentMethods)', { paymentMethods })
        // Held item portions are not payout-eligible (AC-030); restore re-includes under PAID|DELIVERED.
        .andWhere('item.fulfillment_status <> :heldFulfillment', {
          heldFulfillment: FulfillmentStatus.ON_HOLD,
        })
        // Defense in depth: order-level on_hold must never contribute via item join.
        .andWhere('order.status <> :heldOrderStatus', {
          heldOrderStatus: OrderStatus.ON_HOLD,
        })
        // Vendor API historical imports never affect payout balances.
        .andWhere('order.source <> :vendorImportSource', {
          vendorImportSource: OrderDataSource.VENDOR_IMPORT,
        })
    );
  }

  private applyPaidAtCutoff<T extends { andWhere: (clause: string, params?: object) => T }>(
    query: T,
    bucket: 'pre' | 'post',
    goLiveAt: Date,
  ): T {
    if (bucket === 'post') {
      return query.andWhere('order.paid_at >= :goLiveAt', { goLiveAt });
    }
    return query.andWhere('(order.paid_at IS NULL OR order.paid_at < :goLiveAt)', { goLiveAt });
  }

  private async calculateItemSubtotal(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<number> {
    const result = await this.eligibleItemsQuery(storeId, paymentMethods)
      .select('COALESCE(SUM(item.subtotal), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async sumEligibleItemSubtotal(
    storeId: string,
    paymentMethods: PaymentMethod[],
    bucket: 'pre' | 'post',
    goLiveAt: Date,
  ): Promise<number> {
    const result = await this.applyPaidAtCutoff(
      this.eligibleItemsQuery(storeId, paymentMethods),
      bucket,
      goLiveAt,
    )
      .select('COALESCE(SUM(item.subtotal), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  /**
   * Store-scoped promo SUM. Order paid/delivered + rail + order-level on_hold only.
   * Intentionally no order_items / item.fulfillment_status join (AC-D-010 preserved gap).
   */
  private storePromotionDiscountQuery(storeId: string, paymentMethods: PaymentMethod[]) {
    return this.dataSource
      .createQueryBuilder(PromotionUsage, 'usage')
      .innerJoin(Order, 'order', 'order.id = usage.order_id')
      .innerJoin(Promotion, 'promotion', 'promotion.id = usage.promotion_id')
      .where('promotion.store_id = :storeId', { storeId })
      .andWhere('promotion.scope = :scope', { scope: PromotionScope.STORE })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PAID, OrderStatus.DELIVERED],
      })
      .andWhere('order.payment_method IN (:...paymentMethods)', { paymentMethods })
      .andWhere('order.status <> :heldOrderStatus', { heldOrderStatus: OrderStatus.ON_HOLD })
      .andWhere('order.source <> :vendorImportSource', {
        vendorImportSource: OrderDataSource.VENDOR_IMPORT,
      });
  }

  private async calculateStorePromotionDiscounts(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<number> {
    const result = await this.storePromotionDiscountQuery(storeId, paymentMethods)
      .select('COALESCE(SUM(usage.discount_amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async sumStorePromotionDiscounts(
    storeId: string,
    paymentMethods: PaymentMethod[],
    bucket: 'pre' | 'post',
    goLiveAt: Date,
  ): Promise<number> {
    const result = await this.applyPaidAtCutoff(
      this.storePromotionDiscountQuery(storeId, paymentMethods),
      bucket,
      goLiveAt,
    )
      .select('COALESCE(SUM(usage.discount_amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async listEligibleOrderSlices(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<{ product: number; shipping: number }[]> {
    const rows = await this.dataSource
      .createQueryBuilder(OrderItem, 'item')
      .innerJoin(Order, 'order', 'order.id = item.order_id')
      .leftJoin(
        OrderStoreShipping,
        'oss',
        'oss.order_id = order.id AND oss.store_id = item.store_id',
      )
      .where('item.store_id = :storeId', { storeId })
      .andWhere('item.fulfillment_status <> :heldFulfillment', {
        heldFulfillment: FulfillmentStatus.ON_HOLD,
      })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PAID, OrderStatus.DELIVERED],
      })
      .andWhere('order.payment_method IN (:...paymentMethods)', { paymentMethods })
      .andWhere('order.status <> :heldOrderStatus', { heldOrderStatus: OrderStatus.ON_HOLD })
      .andWhere('order.source <> :vendorImportSource', {
        vendorImportSource: OrderDataSource.VENDOR_IMPORT,
      })
      .select('COALESCE(SUM(item.subtotal), 0)', 'product')
      .addSelect(
        `GREATEST(0, LEAST(
          COALESCE(oss.shipping_fee, 0),
          GREATEST(0, order.total - COALESCE(SUM(item.subtotal), 0) + COALESCE(order.discount_amount, 0))
        ))`,
        'shipping',
      )
      .groupBy('order.id')
      .addGroupBy('oss.shipping_fee')
      .addGroupBy('order.total')
      .addGroupBy('order.discount_amount')
      .addGroupBy('order.paid_at')
      .addGroupBy('order.created_at')
      .orderBy('order.paid_at', 'ASC', 'NULLS FIRST')
      .addOrderBy('order.created_at', 'ASC')
      .addOrderBy('order.id', 'ASC')
      .getRawMany<{ product: string; shipping: string }>();

    return rows.map((row) => ({
      product: Number(row.product ?? 0),
      shipping: Number(row.shipping ?? 0),
    }));
  }

  /** All rails: historical Omise-rail payouts still consume the same accrued revenue. */
  private async loadPriorPayoutsForConsume(storeId: string): Promise<PriorPayout[]> {
    const rows = await this.payoutRepository.find({
      where: {
        storeId,
        status: In(PAID_OUT_STATUSES),
      },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    return rows.map((row) => ({
      amount: Number(row.amount),
      productSold: row.productSold == null ? null : Number(row.productSold),
      shippingFees: row.shippingFees == null ? null : Number(row.shippingFees),
      commissionAmount: row.commissionAmount == null ? null : Number(row.commissionAmount),
      commissionRate: row.commissionRate == null ? null : Number(row.commissionRate),
    }));
  }

  private async calculateTotalPaidOut(storeId: string): Promise<number> {
    const result = await this.payoutRepository
      .createQueryBuilder('payout')
      .where('payout.store_id = :storeId', { storeId })
      .andWhere('payout.status IN (:...statuses)', { statuses: PAID_OUT_STATUSES })
      .select('COALESCE(SUM(payout.amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async calculatePendingPayoutAmount(storeId: string): Promise<number> {
    const result = await this.payoutRepository
      .createQueryBuilder('payout')
      .where('payout.store_id = :storeId', { storeId })
      .andWhere('payout.status IN (:...statuses)', { statuses: PENDING_STATUSES })
      .select('COALESCE(SUM(payout.amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private getMinimumPayoutAmount(): number {
    return this.configService.get<number>('payout.minPayoutAmount') ?? 100;
  }

  private hasCompleteBankAccount(store: Store): boolean {
    return Boolean(
      store.bankAccountName?.trim() &&
      store.bankAccountNumber?.trim() &&
      (store.bankName?.trim() || store.bankCode?.trim()),
    );
  }

  private async findStoreOrThrow(storeId: string): Promise<Store> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }
    return store;
  }

  private async assertStoreExists(storeId: string): Promise<void> {
    await this.findStoreOrThrow(storeId);
  }
}
