import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import { Payout, PayoutSettlementRail, PayoutStatus } from '../../database/entities/payout.entity';
import { FulfillmentStatus, OrderItem } from '../../database/entities/order-item.entity';
import { Order, OrderStatus, PaymentMethod } from '../../database/entities/order.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { Promotion, PromotionScope } from '../../database/entities/promotion.entity';
import { PromotionUsage } from '../../database/entities/promotion-usage.entity';
import { OmiseService, OmiseTransfer } from '../omise/omise.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreatePayoutOptions,
  PayoutRailSummary,
  PayoutSummary,
  RejectManualPayoutOptions,
  SettleManualPayoutOptions,
  TriggerPayoutOptions,
} from './payouts.types';

const PAID_OUT_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING, PayoutStatus.COMPLETED];
const PENDING_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING];

/** Omise-collected customer payments — settle via Omise transfer. */
const OMISE_PAYMENT_METHODS = [PaymentMethod.PROMPTPAY, PaymentMethod.CREDIT_CARD];

/** Platform bank-collected — settle via admin manual bank transfer to vendor. */
const MANUAL_PAYMENT_METHODS = [PaymentMethod.BANK_TRANSFER];

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
    private readonly omiseService: OmiseService,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findByStore(storeId: string): Promise<Payout[]> {
    return this.payoutRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingManualPayouts(params: {
    page?: number;
    limit?: number;
  }): Promise<{
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
    await this.assertStoreExists(storeId);

    const [omise, manual, minimumPayoutAmount] = await Promise.all([
      this.buildRailSummary(storeId, PayoutSettlementRail.OMISE, OMISE_PAYMENT_METHODS),
      this.buildRailSummary(storeId, PayoutSettlementRail.MANUAL, MANUAL_PAYMENT_METHODS),
      Promise.resolve(this.getMinimumPayoutAmount()),
    ]);

    // Top-level fields remain Omise-rail for backward-compatible clients / scheduler.
    return {
      storeId,
      grossRevenue: omise.grossRevenue,
      totalPaidOut: omise.totalPaidOut,
      availableBalance: omise.availableBalance,
      pendingPayoutAmount: omise.pendingPayoutAmount,
      minimumPayoutAmount,
      canRequestPayout: omise.canRequestPayout,
      omise,
      manual,
    };
  }

  private async buildRailSummary(
    storeId: string,
    rail: PayoutSettlementRail,
    paymentMethods: PaymentMethod[],
  ): Promise<PayoutRailSummary> {
    const [grossRevenue, totalPaidOut, pendingPayoutAmount, orphanPending] = await Promise.all([
      this.calculateGrossRevenue(storeId, paymentMethods),
      this.calculateTotalPaidOut(storeId, rail),
      this.calculatePendingPayoutAmount(storeId, rail),
      rail === PayoutSettlementRail.OMISE
        ? this.findOrphanPendingPayout(storeId)
        : Promise.resolve(null),
    ]);

    const availableBalance = Math.max(0, grossRevenue - totalPaidOut);
    const hasPending = pendingPayoutAmount > 0;
    const minimumPayoutAmount = this.getMinimumPayoutAmount();

    let canRequestPayout = false;
    if (rail === PayoutSettlementRail.OMISE) {
      canRequestPayout = orphanPending
        ? true
        : !hasPending && availableBalance >= minimumPayoutAmount && availableBalance > 0;
    } else {
      // Manual rail: vendor requests; admin transfers offline then approves.
      canRequestPayout =
        !hasPending && availableBalance >= minimumPayoutAmount && availableBalance > 0;
    }

    return {
      grossRevenue,
      totalPaidOut,
      availableBalance,
      pendingPayoutAmount,
      canRequestPayout,
    };
  }

  async getAvailableBalance(storeId: string): Promise<number> {
    const summary = await this.getPayoutSummary(storeId);
    return summary.availableBalance;
  }

  async requestPayout(storeId: string, processedBy?: string): Promise<Payout> {
    const orphan = await this.findOrphanPendingPayout(storeId);
    if (orphan) {
      return this.submitPayoutToOmise(orphan);
    }

    const summary = await this.getPayoutSummary(storeId);
    const omise = summary.omise;

    if (omise.pendingPayoutAmount > 0) {
      throw new BadRequestException({
        code: 'PAYOUT_ALREADY_PENDING',
        message: 'An Omise payout is already pending for this store',
      });
    }

    if (omise.availableBalance <= 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'No Omise funds available for payout',
      });
    }

    if (omise.availableBalance < summary.minimumPayoutAmount) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `Minimum payout amount is ${summary.minimumPayoutAmount}`,
      });
    }

    return this.createOmisePayout(storeId, omise.availableBalance, {
      processedBy,
      notes: 'Vendor requested payout',
    });
  }

  async triggerPayout(storeId: string, options: TriggerPayoutOptions = {}): Promise<Payout> {
    const orphan = await this.findOrphanPendingPayout(storeId);
    if (orphan) {
      // Prefer completing the DB-only orphan over creating a second payout.
      return this.submitPayoutToOmise(orphan);
    }

    const summary = await this.getPayoutSummary(storeId);
    const amount = options.amount ?? summary.omise.availableBalance;

    if (amount <= 0) {
      throw new BadRequestException({
        code: 'INVALID_PAYOUT_AMOUNT',
        message: 'Payout amount must be greater than zero',
      });
    }

    if (amount > summary.omise.availableBalance) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'Payout amount exceeds Omise available balance',
      });
    }

    if (!options.bypassMinimum && amount < summary.minimumPayoutAmount) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `Minimum payout amount is ${summary.minimumPayoutAmount}`,
      });
    }

    return this.createOmisePayout(storeId, amount, {
      processedBy: options.processedBy,
      notes: options.notes ?? 'Admin triggered Omise payout',
    });
  }

  /**
   * Vendor requests settlement of bank_transfer revenue (manual rail).
   * Creates a PENDING payout; admin transfers offline then calls settleManualPayout.
   */
  async requestManualPayout(storeId: string, processedBy?: string): Promise<Payout> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    const summary = await this.getPayoutSummary(storeId);
    const manual = summary.manual;

    if (manual.pendingPayoutAmount > 0) {
      throw new BadRequestException({
        code: 'PAYOUT_ALREADY_PENDING',
        message: 'A manual payout is already pending for this store',
      });
    }

    if (manual.availableBalance <= 0) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: 'No bank-transfer funds available for payout',
      });
    }

    if (manual.availableBalance < summary.minimumPayoutAmount) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `Minimum payout amount is ${summary.minimumPayoutAmount}`,
      });
    }

    const amount = manual.availableBalance;
    const fee = 0;
    const netAmount = amount - fee;

    const payout = await this.dataSource.transaction(async (manager) => {
      await this.lockStoreRowForPayout(manager, storeId);
      await this.assertNoConcurrentPendingPayout(manager, storeId, PayoutSettlementRail.MANUAL);

      const created = manager.getRepository(Payout).create({
        storeId,
        amount,
        fee,
        netAmount,
        status: PayoutStatus.PENDING,
        settlementRail: PayoutSettlementRail.MANUAL,
        transferReference: null,
        processedBy: processedBy ?? null,
        processedAt: null,
        notes: 'Vendor requested manual payout',
      });
      return manager.getRepository(Payout).save(created);
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

    return payout;
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

    return this.dataSource.transaction(async (manager) => {
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

    return this.dataSource.transaction(async (manager) => {
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

  /** @deprecated Use createOmisePayout — kept for scheduler call sites. */
  async createManualPayout(
    storeId: string,
    amount: number,
    options: CreatePayoutOptions = {},
  ): Promise<Payout> {
    return this.createOmisePayout(storeId, amount, options);
  }

  async createOmisePayout(
    storeId: string,
    amount: number,
    options: CreatePayoutOptions = {},
  ): Promise<Payout> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    await this.refreshStoreRecipientStatus(store);

    if (this.omiseService.hasCredentials()) {
      this.assertRecipientReadyForTransfer(store);
    }

    const fee = 0;
    const netAmount = amount - fee;

    // Both requestPayout (vendor) and triggerPayout (admin) read the pending-payout summary
    // and only create a payout if it's zero, with no lock in between - two concurrent calls
    // (double-click, or vendor + admin racing) can otherwise both pass that check and each
    // create their own PENDING payout for the same available balance, double-paying the
    // store once Omise transfers are applied below. Locking the store row inside a
    // transaction serializes concurrent creates for the same store; the recheck after
    // acquiring the lock is what actually catches the race (the pre-check above is just a
    // fast-fail for the common case).
    const payout = await this.dataSource.transaction(async (manager) => {
      await this.lockStoreRowForPayout(manager, storeId);
      await this.assertNoConcurrentPendingPayout(manager, storeId, PayoutSettlementRail.OMISE);

      const created = manager.getRepository(Payout).create({
        storeId,
        amount,
        fee,
        netAmount,
        status: PayoutStatus.PENDING,
        settlementRail: PayoutSettlementRail.OMISE,
        processedBy: options.processedBy ?? null,
        notes: options.notes ?? null,
      });
      return manager.getRepository(Payout).save(created);
    });

    if (
      this.omiseService.hasCredentials() &&
      store.omiseRecipientId &&
      store.omiseRecipientStatus === OmiseRecipientStatus.ACTIVE
    ) {
      await this.applyOmiseTransfer(payout, store.omiseRecipientId, netAmount);
    }

    return this.payoutRepository.save(payout);
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
    rail: PayoutSettlementRail,
  ): Promise<void> {
    const pending = await manager.getRepository(Payout).findOne({
      where: { storeId, settlementRail: rail, status: In(PENDING_STATUSES) },
    });

    if (pending) {
      throw new BadRequestException({
        code: 'PAYOUT_ALREADY_PENDING',
        message: `A ${rail} payout is already pending for this store`,
      });
    }
  }

  /**
   * Handles Omise transfer.* webhooks. Looks up the local payout by
   * transferReference and marks it completed or failed.
   */
  async handleOmiseTransferWebhook(payload: {
    key?: string;
    data?: {
      object?: string;
      id?: string;
      paid?: boolean;
      sent?: boolean;
      failure_code?: string | null;
      failure_message?: string | null;
    };
  }): Promise<void> {
    const transferId = payload.data?.id;
    if (!transferId || payload.data?.object !== 'transfer') {
      return;
    }

    const payout = await this.payoutRepository.findOne({
      where: { transferReference: transferId },
    });
    if (!payout) {
      this.logger.warn(`No payout for Omise transfer ${transferId}`);
      return;
    }

    if (payout.status === PayoutStatus.COMPLETED || payout.status === PayoutStatus.FAILED) {
      return;
    }

    let transfer: OmiseTransfer | null = null;
    if (this.omiseService.hasCredentials()) {
      try {
        transfer = await this.omiseService.getTransfer(transferId);
      } catch (error) {
        this.logger.error(
          `Failed to re-fetch Omise transfer ${transferId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }

    const paid = transfer?.paid ?? payload.data?.paid ?? false;
    const failed =
      payload.key === 'transfer.fail' ||
      Boolean(transfer?.failure_code ?? payload.data?.failure_code);

    if (payload.key === 'transfer.pay' || paid) {
      payout.status = PayoutStatus.COMPLETED;
      payout.processedAt = new Date();
      payout.failureReason = null;
      await this.payoutRepository.save(payout);
      return;
    }

    if (failed) {
      payout.status = PayoutStatus.FAILED;
      payout.failureReason =
        transfer?.failure_message ??
        payload.data?.failure_message ??
        transfer?.failure_code ??
        payload.data?.failure_code ??
        'Omise transfer failed';
      await this.payoutRepository.save(payout);
      return;
    }

    if (payload.key === 'transfer.send' || transfer?.sent) {
      payout.status = PayoutStatus.PROCESSING;
      await this.payoutRepository.save(payout);
    }
  }

  /**
   * Retries Omise transfer creation for a pending payout that was never sent
   * (no transferReference). Used when recipient was still pending at request time.
   */
  private async submitPayoutToOmise(payout: Payout): Promise<Payout> {
    const store = await this.storeRepository.findOne({ where: { id: payout.storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }

    await this.refreshStoreRecipientStatus(store);

    if (!this.omiseService.hasCredentials()) {
      throw new BadRequestException({
        code: 'OMISE_NOT_CONFIGURED',
        message: 'Omise API keys are not configured on the server',
      });
    }

    this.assertRecipientReadyForTransfer(store);

    // Two concurrent requestPayout/triggerPayout calls can both load the same orphan payout
    // (PENDING, no transferReference) before either submits it - without a claim step here,
    // both would call Omise's createTransfer for the same amount, i.e. a real double payment.
    // Atomically flip it to PROCESSING inside a row lock first; only the caller that wins the
    // claim proceeds to call Omise.
    const claimed = await this.claimOrphanPayoutForSubmission(payout.id);
    if (!claimed) {
      const latest = await this.payoutRepository.findOne({ where: { id: payout.id } });
      if (!latest) {
        throw new NotFoundException({ code: 'PAYOUT_NOT_FOUND', message: 'Payout not found' });
      }
      return latest;
    }

    try {
      await this.applyOmiseTransfer(
        claimed,
        store.omiseRecipientId as string,
        Number(claimed.netAmount),
      );
    } catch (error) {
      await this.payoutRepository.save(claimed);
      throw error;
    }
    return this.payoutRepository.save(claimed);
  }

  /**
   * Atomically claims an orphan pending payout for Omise submission by flipping it to
   * PROCESSING inside a row lock, so a concurrent submitPayoutToOmise call on the same row
   * backs off instead of also calling Omise. Returns null if another caller already claimed
   * or completed it by the time the lock was acquired.
   */
  private async claimOrphanPayoutForSubmission(payoutId: string): Promise<Payout | null> {
    return this.dataSource.transaction(async (manager) => {
      const payout = await manager
        .getRepository(Payout)
        .createQueryBuilder('payout')
        .where('payout.id = :payoutId', { payoutId })
        .setLock('pessimistic_write')
        .getOne();

      if (!payout || payout.status !== PayoutStatus.PENDING || payout.transferReference) {
        return null;
      }

      payout.status = PayoutStatus.PROCESSING;
      return manager.getRepository(Payout).save(payout);
    });
  }

  private async applyOmiseTransfer(
    payout: Payout,
    recipientId: string,
    netAmount: number,
  ): Promise<void> {
    try {
      const transfer = await this.omiseService.createTransfer(
        recipientId,
        Math.round(netAmount * 100),
      );
      payout.transferReference = transfer.id;
      payout.status = PayoutStatus.PROCESSING;
      payout.failureReason = null;
      if (transfer.paid) {
        payout.status = PayoutStatus.COMPLETED;
        payout.processedAt = new Date();
      }
    } catch (error) {
      this.logger.error(
        `Omise transfer failed for store ${payout.storeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      payout.status = PayoutStatus.PENDING;
      payout.failureReason = error instanceof Error ? error.message : 'Omise transfer failed';
      throw new BadRequestException({
        code: 'OMISE_TRANSFER_FAILED',
        message: payout.failureReason,
      });
    }
  }

  private assertRecipientReadyForTransfer(store: Store): void {
    if (!store.omiseRecipientId) {
      throw new BadRequestException({
        code: 'OMISE_RECIPIENT_NOT_CONNECTED',
        message: 'Store bank account is not linked to Omise. Save payout bank details first.',
      });
    }

    if (store.omiseRecipientStatus !== OmiseRecipientStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'OMISE_RECIPIENT_NOT_READY',
        message: 'Omise recipient is not active yet. Wait for Omise verification, then try again.',
      });
    }
  }

  private async refreshStoreRecipientStatus(store: Store): Promise<void> {
    if (!store.omiseRecipientId || !this.omiseService.hasCredentials()) {
      return;
    }

    try {
      const recipient = await this.omiseService.getRecipient(store.omiseRecipientId);
      const nextStatus =
        recipient.verified && recipient.active
          ? OmiseRecipientStatus.ACTIVE
          : OmiseRecipientStatus.PENDING;
      if (store.omiseRecipientStatus !== nextStatus) {
        store.omiseRecipientStatus = nextStatus;
        if (nextStatus === OmiseRecipientStatus.ACTIVE) {
          store.omiseRecipientFailureMessage = null;
        }
        await this.storeRepository.save(store);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to refresh Omise recipient ${store.omiseRecipientId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async findOrphanPendingPayout(storeId: string): Promise<Payout | null> {
    return this.payoutRepository.findOne({
      where: {
        storeId,
        settlementRail: PayoutSettlementRail.OMISE,
        status: PayoutStatus.PENDING,
        transferReference: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
  }

  private async calculateGrossRevenue(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<number> {
    const [itemSubtotal, storePromotionDiscounts] = await Promise.all([
      this.calculateItemSubtotal(storeId, paymentMethods),
      this.calculateStorePromotionDiscounts(storeId, paymentMethods),
    ]);

    // A vendor's OWN store-scoped promotion is a discount the vendor chose to give -
    // OrderItem.subtotal is always the raw pre-discount line amount (discountAmount only
    // ever lived at the Order header level), so without this the vendor was credited the
    // full undiscounted amount while the customer paid less, with nobody actually bearing
    // the cost of the vendor's own promo. Platform-wide promotions are intentionally left
    // untouched here - the platform funds those out of its own margin, which is a business
    // policy choice, not this bug.
    return Math.max(0, itemSubtotal - storePromotionDiscounts);
  }

  private async calculateItemSubtotal(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<number> {
    const result = await this.orderItemRepository
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
      .select('COALESCE(SUM(item.subtotal), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async calculateStorePromotionDiscounts(
    storeId: string,
    paymentMethods: PaymentMethod[],
  ): Promise<number> {
    const result = await this.dataSource
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
      .select('COALESCE(SUM(usage.discount_amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async calculateTotalPaidOut(
    storeId: string,
    rail: PayoutSettlementRail,
  ): Promise<number> {
    const result = await this.payoutRepository
      .createQueryBuilder('payout')
      .where('payout.store_id = :storeId', { storeId })
      .andWhere('payout.settlement_rail = :rail', { rail })
      .andWhere('payout.status IN (:...statuses)', { statuses: PAID_OUT_STATUSES })
      .select('COALESCE(SUM(payout.amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private async calculatePendingPayoutAmount(
    storeId: string,
    rail: PayoutSettlementRail,
  ): Promise<number> {
    const result = await this.payoutRepository
      .createQueryBuilder('payout')
      .where('payout.store_id = :storeId', { storeId })
      .andWhere('payout.settlement_rail = :rail', { rail })
      .andWhere('payout.status IN (:...statuses)', { statuses: PENDING_STATUSES })
      .select('COALESCE(SUM(payout.amount), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
  }

  private getMinimumPayoutAmount(): number {
    return this.configService.get<number>('payout.minPayoutAmount') ?? 100;
  }

  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }
  }
}
