import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExecutionContext } from '@nestjs/common';
import { VendorStatusGuard } from './vendor-status.guard';
import { User } from '../../../database/entities/user.entity';

describe('VendorStatusGuard', () => {
  let guard: VendorStatusGuard;
  const userRepo = { findOne: jest.fn() };

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
      providers: [VendorStatusGuard, { provide: getRepositoryToken(User), useValue: userRepo }],
    }).compile();

    guard = module.get(VendorStatusGuard);
  });

  it('allows non-vendor roles', async () => {
    const result = await guard.canActivate(contextFor({ id: 'a1', role: 'admin' }));
    expect(result).toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows requests without a user', async () => {
    const result = await guard.canActivate(contextFor(undefined));
    expect(result).toBe(true);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows active vendors', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'v1', isActive: true });
    const result = await guard.canActivate(contextFor({ id: 'v1', role: 'vendor' }));
    expect(result).toBe(true);
  });

  it('blocks suspended vendors', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'v1', isActive: false });
    await expect(guard.canActivate(contextFor({ id: 'v1', role: 'vendor' }))).rejects.toMatchObject(
      { response: { code: 'ACCOUNT_SUSPENDED' } },
    );
  });

  it('allows when vendor row is missing (JwtAuthGuard owns auth)', async () => {
    userRepo.findOne.mockResolvedValue(null);
    const result = await guard.canActivate(contextFor({ id: 'missing', role: 'vendor' }));
    expect(result).toBe(true);
  });
});
