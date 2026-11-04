import { GuestOrderLinkService } from './guest-order-link.service';

describe('GuestOrderLinkService', () => {
  const orderRepository = {
    update: jest.fn(),
    findOne: jest.fn(),
  };
  const customerRepository = {
    setEmailIfMissing: jest.fn(),
  };

  let service: GuestOrderLinkService;

  beforeEach(() => {
    jest.clearAllMocks();
    orderRepository.update.mockResolvedValue({ affected: 1 });
    orderRepository.findOne.mockResolvedValue(null);
    customerRepository.setEmailIfMissing.mockResolvedValue(false);
    service = new GuestOrderLinkService(orderRepository as never, customerRepository as never);
  });

  it('links guest orders by phone and returns affected count', async () => {
    const affected = await service.mergeGuestOrders('cust-1', '0812345678');

    expect(affected).toBe(1);
    expect(orderRepository.update).toHaveBeenCalled();
  });

  it('copies the newest guestEmail onto the customer when email is missing', async () => {
    orderRepository.findOne.mockResolvedValue({
      id: 'ord-2',
      guestEmail: 'from-order@example.com',
      createdAt: new Date(),
    });
    customerRepository.setEmailIfMissing.mockResolvedValue(true);

    await service.mergeGuestOrders('cust-1', '0812345678');

    expect(orderRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ customerId: 'cust-1' }),
        order: { createdAt: 'DESC' },
      }),
    );
    expect(customerRepository.setEmailIfMissing).toHaveBeenCalledWith(
      'cust-1',
      'from-order@example.com',
    );
  });

  it('skips email backfill when linked orders have no guestEmail', async () => {
    orderRepository.findOne.mockResolvedValue({ id: 'ord-1', guestEmail: null });

    await service.mergeGuestOrders('cust-1', '0812345678');

    expect(customerRepository.setEmailIfMissing).not.toHaveBeenCalled();
  });
});
