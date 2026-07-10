import { Injectable } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { Payment } from '../../database/entities/payment.entity';

export const PAYMENT_STATUS_UPDATED = 'paymentStatusUpdated';

export type PaymentStatusUpdatedPayload = {
  paymentStatusUpdated: {
    id: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
    paymentMethod: string;
    authorizeUri: string | null;
    qrCodeUrl: string | null;
    expiresAt: Date | null;
  };
};

function mapPaymentToPayload(
  payment: Payment,
): PaymentStatusUpdatedPayload['paymentStatusUpdated'] {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amount: Number(payment.amount),
    currency: payment.currency,
    status: payment.status,
    paymentMethod: payment.paymentMethod,
    authorizeUri: payment.authorizeUri ?? null,
    qrCodeUrl: payment.qrCodeUrl ?? null,
    expiresAt: payment.expiresAt ?? null,
  };
}

@Injectable()
export class PaymentEventsService {
  private readonly pubSub = new PubSub();

  paymentStatusUpdatedIterator() {
    return this.pubSub.asyncIterableIterator<PaymentStatusUpdatedPayload>(PAYMENT_STATUS_UPDATED);
  }

  async publishPaymentStatusUpdated(payment: Payment): Promise<void> {
    await this.pubSub.publish(PAYMENT_STATUS_UPDATED, {
      paymentStatusUpdated: mapPaymentToPayload(payment),
    });
  }
}
