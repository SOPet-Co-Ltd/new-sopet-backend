import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutionContext } from '@nestjs/common';
import { CustomerStatusGuard } from './customer-status.guard';
import { Customer } from '../../../database/entities/customer.entity';

describe('CustomerStatusGuard', () => {
  let guard: CustomerStatusGuard;
  const customerRepo = { findOne: jest.fn() };

  function contextFor(user: unknown): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerStatusGuard,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
      ],
    }).compile();

    guard = module.get(CustomerStatusGuard);
  });

  it('allows non-customer roles', async () => {
    const result = await guard.canActivate(contextFor({ id: 'u1', role: 'admin' }));
    expect(result).toBe(true);
    expect(customerRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows active customers', async () => {
    customerRepo.findOne.mockResolvedValue({ id: 'c1', isActive: true });
    const result = await guard.canActivate(contextFor({ id: 'c1', role: 'customer' }));
    expect(result).toBe(true);
  });

  it('blocks suspended customers', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'c1',
      isActive: false,
      deletionRequestedAt: null,
    });
    await expect(
      guard.canActivate(contextFor({ id: 'c1', role: 'customer' })),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_SUSPENDED' } });
  });

  it('blocks pending-deletion customers', async () => {
    customerRepo.findOne.mockResolvedValue({
      id: 'c1',
      isActive: false,
      deletionRequestedAt: new Date(),
    });
    await expect(
      guard.canActivate(contextFor({ id: 'c1', role: 'customer' })),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_PENDING_DELETION' } });
  });
});
