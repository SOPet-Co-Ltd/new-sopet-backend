import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentMethod } from '../../database/entities/enums/order.enums';
import { Payment } from '../../database/entities/payment.entity';
import { BeamService } from '../beam/beam.service';

/** Beam Refunds API does not accept TrueMoney or ShopeePay charges. */
export function requiresManualBeamRefund(method: string | null | undefined): boolean {
  return method === PaymentMethod.TRUEMONEY || method === PaymentMethod.SHOPEEPAY;
}

export const MANUAL_BEAM_REFUND_NOTE =
  'Beam does not support refunds for this payment method. Refund the customer manually.';

@Injectable()
export class BeamRefundService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly beamService: BeamService,
  ) {}

  /**
   * Refund every paid Beam charge on this order.
   * No-ops when nothing was captured (unpaid, bank transfer, historical Omise).
   * The idempotency key is the payment id so a retry does not create a second refund.
   * Local payment rows stay `paid` until the caller commits the cancellation.
   */
  async refundPaidBeamCharges(orderId: string, reason: string): Promise<string[]> {
    const payments = await this.paymentRepository.find({
      where: { orderId, status: 'paid', psp: 'beam' },
    });
    const targets = payments.filter(
      (payment) =>
        Boolean(payment.pspChargeId?.trim()) && !requiresManualBeamRefund(payment.paymentMethod),
    );
    if (targets.length === 0) {
      return [];
    }
    if (!this.beamService.hasCredentials()) {
      throw new BadRequestException({
        code: 'BEAM_NOT_CONFIGURED',
        message: 'Beam credentials are required to refund a paid charge',
      });
    }

    const refundedIds: string[] = [];
    for (const payment of targets) {
      await this.beamService.createRefund(
        {
          chargeId: payment.pspChargeId!.trim(),
          reason: reason.slice(0, 500),
        },
        { idempotencyKey: `refund:${payment.id}` },
      );
      refundedIds.push(payment.id);
    }
    return refundedIds;
  }
}
