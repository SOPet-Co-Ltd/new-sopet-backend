import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payout, PayoutStatus } from '../../database/entities/payout.entity';
import { Store, OmiseRecipientStatus } from '../../database/entities/store.entity';
import { OmiseService } from '../omise/omise.service';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @InjectRepository(Payout)
    private readonly payoutRepository: Repository<Payout>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly omiseService: OmiseService,
  ) {}

  async findByStore(storeId: string): Promise<Payout[]> {
    return this.payoutRepository.find({
      where: { storeId },
      order: { createdAt: 'DESC' },
    });
  }

  async createManualPayout(storeId: string, amount: number): Promise<Payout> {
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
    });

    // If the store has an active Omise recipient, send the funds to the real
    // Omise account instead of leaving the payout for manual processing.
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
}
