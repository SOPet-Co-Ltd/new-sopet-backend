import { CustomerRepository } from './customer.repository';

describe('CustomerRepository', () => {
  const repository = {
    findOne: jest.fn(),
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => data),
    update: jest.fn(),
  };

  let customerRepository: CustomerRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    customerRepository = new CustomerRepository(repository as never);
  });

  it('finds active customers by local or E.164 phone variants', async () => {
    repository.findOne.mockResolvedValue({ id: 'cust-1', phone: '+66812345678' });

    const customer = await customerRepository.findActiveByPhone('0812345678');

    expect(customer?.id).toBe('cust-1');
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: expect.anything(),
        }),
      }),
    );
  });

  it('returns null when another customer owns the phone', async () => {
    repository.findOne.mockResolvedValue({ id: 'cust-2', phone: '0812345678' });

    const customer = await customerRepository.findOtherActiveByPhone('0812345678', 'cust-1');

    expect(customer?.id).toBe('cust-2');
  });

  it('returns null when the only match is the excluded customer', async () => {
    repository.findOne.mockResolvedValue({ id: 'cust-1', phone: '0812345678' });

    const customer = await customerRepository.findOtherActiveByPhone('0812345678', 'cust-1');

    expect(customer).toBeNull();
  });

  it('normalizes phone before creating a customer', async () => {
    repository.findOne.mockResolvedValue(null);

    await customerRepository.createOrUpdate('+66812345678', { isVerified: true });

    expect(repository.create).toHaveBeenCalledWith({
      phone: '0812345678',
      isVerified: true,
    });
  });
});
