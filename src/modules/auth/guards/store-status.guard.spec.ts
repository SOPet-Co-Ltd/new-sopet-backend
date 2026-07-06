import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { StoreStatusGuard } from './store-status.guard';
import { Store, StoreStatus } from '../../../database/entities/store.entity';

describe('StoreStatusGuard', () => {
  let guard: StoreStatusGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let storeRepository: { findOne: jest.Mock };

  function contextFor(user: unknown): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    storeRepository = { findOne: jest.fn() };
    guard = new StoreStatusGuard(
      reflector as unknown as Reflector,
      storeRepository as unknown as Repository<Store>,
    );
  });

  it('allows allowlisted routes without checking the store', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(
      guard.canActivate(contextFor({ role: 'vendor', storeId: 'store-1' })),
    ).resolves.toBe(true);
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows non-vendor users', async () => {
    await expect(guard.canActivate(contextFor({ role: 'admin' }))).resolves.toBe(true);
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows vendors without an active store', async () => {
    await expect(guard.canActivate(contextFor({ role: 'vendor' }))).resolves.toBe(true);
    expect(storeRepository.findOne).not.toHaveBeenCalled();
  });

  it('allows vendors whose active store is approved', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.APPROVED,
    });

    await expect(
      guard.canActivate(contextFor({ role: 'vendor', storeId: 'store-1' })),
    ).resolves.toBe(true);
  });

  it('blocks vendors whose active store is suspended', async () => {
    storeRepository.findOne.mockResolvedValue({
      id: 'store-1',
      status: StoreStatus.SUSPENDED,
    });

    await expect(
      guard.canActivate(contextFor({ role: 'vendor', storeId: 'store-1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
