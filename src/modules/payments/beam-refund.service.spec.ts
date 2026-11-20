import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BeamService } from '../beam/beam.service';
import { Payment } from '../../database/entities/payment.entity';
import { BeamRefundService } from './beam-refund.service';

describe('BeamRefundService', () => {
  let service: BeamRefundService;
  const paymentRepository = { find: jest.fn() };
  const beamService = {
    hasCredentials: jest.fn().mockReturnValue(true),
    createRefund: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    beamService.hasCredentials.mockReturnValue(true);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BeamRefundService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        { provide: BeamService, useValue: beamService },
      ],
    }).compile();
    service = module.get(BeamRefundService);
  });

  it('creates a full Beam refund for each paid Beam charge', async () => {
    paymentRepository.find.mockResolvedValue([
      {
        id: 'pay-1',
        orderId: 'ord-1',
        status: 'paid',
        psp: 'beam',
        pspChargeId: 'ch_paid',
      },
      {
        id: 'pay-blank',
        orderId: 'ord-1',
        status: 'paid',
        psp: 'beam',
        pspChargeId: '  ',
      },
    ]);
    beamService.createRefund.mockResolvedValue({ refundId: 'rf_1' });

    const ids = await service.refundPaidBeamCharges('ord-1', 'Order cancelled after payment');

    expect(ids).toEqual(['pay-1']);
    expect(beamService.createRefund).toHaveBeenCalledWith(
      { chargeId: 'ch_paid', reason: 'Order cancelled after payment' },
      { idempotencyKey: 'refund:pay-1' },
    );
  });

  it('does not call Beam when the order has no paid Beam charge', async () => {
    paymentRepository.find.mockResolvedValue([]);

    const ids = await service.refundPaidBeamCharges('ord-1', 'Order cancelled after payment');

    expect(ids).toEqual([]);
    expect(beamService.createRefund).not.toHaveBeenCalled();
    expect(beamService.hasCredentials).not.toHaveBeenCalled();
  });
});
