import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';

@Injectable()
export class PaymentExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentExpiryScheduler.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('payment.expiryCheckIntervalMs') ?? 30_000;

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
  }
}
