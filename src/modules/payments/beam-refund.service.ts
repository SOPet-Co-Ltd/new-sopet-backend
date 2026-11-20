import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../database/entities/payment.entity';
import { BeamService } from '../beam/beam.service';

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
    const targets = payments.filter((payment) => Boolean(payment.pspChargeId?.trim()));
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
