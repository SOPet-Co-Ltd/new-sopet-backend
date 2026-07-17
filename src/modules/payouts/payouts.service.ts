import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { OmiseService, OmiseTransfer } from '../omise/omise.service';
import { CreatePayoutOptions, PayoutSummary, TriggerPayoutOptions } from './payouts.types';

const PAID_OUT_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING, PayoutStatus.COMPLETED];
const PENDING_STATUSES = [PayoutStatus.PENDING, PayoutStatus.PROCESSING];

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
    private readonly omiseService: OmiseService,
    private readonly configService: ConfigService,
  ) {}

  async findByStore(storeId: string): Promise<Payout[]> {
    return this.payoutRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async getPayoutSummary(storeId: string): Promise<PayoutSummary> {
    await this.assertStoreExists(storeId);

    const [grossRevenue, totalPaidOut, pendingPayoutAmount, orphanPending] = await Promise.all([
      this.calculateGrossRevenue(storeId),
      this.calculateTotalPaidOut(storeId),
      this.calculatePendingPayoutAmount(storeId),
      this.findOrphanPendingPayout(storeId),
    ]);

    const availableBalance = Math.max(0, grossRevenue - totalPaidOut);
    const minimumPayoutAmount = this.getMinimumPayoutAmount();
    const hasPending = pendingPayoutAmount > 0;

    return {
      storeId,
      grossRevenue,
      totalPaidOut,
      availableBalance,
      pendingPayoutAmount,
      minimumPayoutAmount,
      // Orphan pending rows (DB-only, never sent to Omise) are retryable.
      canRequestPayout: orphanPending
        ? true
        : !hasPending && availableBalance >= minimumPayoutAmount && availableBalance > 0,
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

    return this.createManualPayout(storeId, summary.availableBalance, {
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

  async createManualPayout(
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
    const payout = this.payoutRepository.create({
      storeId,
      amount,
      fee,
      netAmount,
      status: PayoutStatus.PENDING,
      processedBy: options.processedBy ?? null,
      notes: options.notes ?? null,
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

    try {
      await this.applyOmiseTransfer(
        payout,
        store.omiseRecipientId as string,
        Number(payout.netAmount),
      );
    } catch (error) {
      await this.payoutRepository.save(payout);
      throw error;
    }
    return this.payoutRepository.save(payout);
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
        status: PayoutStatus.PENDING,
        transferReference: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
  }

  private async calculateGrossRevenue(storeId: string): Promise<number> {
    const result = await this.orderItemRepository
      .createQueryBuilder('item')
      .innerJoin(Order, 'order', 'order.id = item.order_id')
      .where('item.store_id = :storeId', { storeId })
      .andWhere('order.status IN (:...statuses)', {
        statuses: [OrderStatus.PAID, OrderStatus.DELIVERED],
      })
      .select('COALESCE(SUM(item.subtotal), 0)', 'total')
      .getRawOne<{ total: string }>();

    return Number(result?.total ?? 0);
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
    return this.configService.get<number>('payout.minPayoutAmount') ?? 500;
  }

  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.storeRepository.findOne({ where: { id: storeId } });
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store not found' });
    }
  }
}
