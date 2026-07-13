import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { Order, OrderStatus } from '../../database/entities/order.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { OmiseService } from '../omise/omise.service';
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

    const [grossRevenue, totalPaidOut, pendingPayoutAmount] = await Promise.all([
      this.calculateGrossRevenue(storeId),
      this.calculateTotalPaidOut(storeId),
      this.calculatePendingPayoutAmount(storeId),
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
      canRequestPayout:
        !hasPending && availableBalance >= minimumPayoutAmount && availableBalance > 0,
    };
  }

  async getAvailableBalance(storeId: string): Promise<number> {
    const summary = await this.getPayoutSummary(storeId);
    return summary.availableBalance;
  }

  async requestPayout(storeId: string, processedBy?: string): Promise<Payout> {
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
      try {
        const transfer = await this.omiseService.createTransfer(
          store.omiseRecipientId,
          Math.round(netAmount * 100),
        );
        payout.transferReference = transfer.id;
        payout.status = PayoutStatus.PROCESSING;
      } catch (error) {
        this.logger.error(
          `Omise transfer failed for store ${storeId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        payout.status = PayoutStatus.PENDING;
        payout.failureReason = error instanceof Error ? error.message : 'Omise transfer failed';
      }
    }

    return this.payoutRepository.save(payout);
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
