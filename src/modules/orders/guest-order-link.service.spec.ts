import { In, IsNull } from 'typeorm';
import { GuestOrderLinkService } from './guest-order-link.service';

describe('GuestOrderLinkService', () => {
  let service: GuestOrderLinkService;
  let orderRepository: {
    update: jest.Mock;
    find: jest.Mock;
  };

  beforeEach(() => {
    orderRepository = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };

    service = new GuestOrderLinkService(orderRepository as never);
  });

  it('clears guestPhone on merge so phone-based lookup returns empty', async () => {
    const merged = await service.mergeGuestOrders('cust-1', '0812345678');

    expect(merged).toBe(1);
    expect(orderRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: IsNull(),
        guestPhone: In(['0812345678', '+66812345678']),
      }),
      { customerId: 'cust-1', guestPhone: null },
    );
  });
});
