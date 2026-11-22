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

  describe('setEmailIfMissing', () => {
    it('sets email when the customer has none', async () => {
      repository.findOne.mockResolvedValue({ id: 'cust-1', email: null });

      const wrote = await customerRepository.setEmailIfMissing('cust-1', '  new@example.com  ');

      expect(wrote).toBe(true);
      expect(repository.update).toHaveBeenCalledWith('cust-1', { email: 'new@example.com' });
    });

    it('does nothing when the customer already has an email', async () => {
      repository.findOne.mockResolvedValue({ id: 'cust-1', email: 'old@example.com' });

      const wrote = await customerRepository.setEmailIfMissing('cust-1', 'new@example.com');

      expect(wrote).toBe(false);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('rejects invalid email values', async () => {
      const wrote = await customerRepository.setEmailIfMissing('cust-1', 'not-an-email');

      expect(wrote).toBe(false);
      expect(repository.findOne).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
