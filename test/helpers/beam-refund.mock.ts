import { BeamRefundService } from '../../src/modules/payments/beam-refund.service';

export const mockBeamRefundProvider = {
  provide: BeamRefundService,
  useValue: {
    refundPaidBeamCharges: jest.fn().mockResolvedValue([]),
  },
};
