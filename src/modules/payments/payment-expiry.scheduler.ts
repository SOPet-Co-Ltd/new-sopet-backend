import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { StoreSuspensionHoldService } from '../orders/store-suspension-hold.service';

@Injectable()
export class PaymentExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryScheduler.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    private readonly storeSuspensionHoldService: StoreSuspensionHoldService,
  ) {}

  onModuleInit(): void {
    const paymentIntervalMs =
      this.configService.get<number>('payment.expiryCheckIntervalMs') ?? 30_000;
    const holdSlaIntervalMs =
      this.configService.get<number>('storeHold.slaCheckIntervalMs') ?? paymentIntervalMs;
    const intervalMs = Math.min(paymentIntervalMs, holdSlaIntervalMs);

    this.intervalHandle = setInterval(() => {
      void this.runExpiryCheck();
    }, intervalMs);

    this.logger.log(`Payment expiry scheduler started (every ${intervalMs}ms)`);
    void this.runExpiryCheck();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async runExpiryCheck(): Promise<void> {
    try {
      const expiredCount = await this.paymentsService.expirePendingQrPayments();
      if (expiredCount > 0) {
        this.logger.log(`Expired ${expiredCount} pending QR payment(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Payment expiry check failed',
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      const cancelledCount = await this.paymentsService.cancelStaleUnpaidOrders();
      if (cancelledCount > 0) {
        this.logger.log(`Cancelled ${cancelledCount} stale unpaid order(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Unpaid order cancel check failed',
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      const heldCancelled = await this.storeSuspensionHoldService.cancelExpiredHeldItems();
      if (heldCancelled > 0) {
        this.logger.log(`Hold SLA cancelled ${heldCancelled} held item(s)`);
      }
    } catch (error) {
      this.logger.error(
        'Hold SLA cancel check failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
