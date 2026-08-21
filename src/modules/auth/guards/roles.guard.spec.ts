import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RolesGuard } from './roles.guard';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../../../common/decorators';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  function contextFor(user?: { role?: string }): ExecutionContext {
    return {
      getHandler: () => 'handler',
      getClass: () => 'class',
      getType: () => 'graphql',
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: { user: undefined } }),
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows @Public routes without roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });

    expect(guard.canActivate(contextFor())).toBe(true);
  });

  it('denies authenticated handlers missing @Roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return undefined;
      return undefined;
    });
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: { user: { role: 'customer' } } }),
    } as never);

    expect(() => guard.canActivate(contextFor({ role: 'customer' }))).toThrow(ForbiddenException);
  });

  it('allows matching role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['customer'];
      return undefined;
    });
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: { user: { role: 'customer' } } }),
    } as never);

    expect(guard.canActivate(contextFor({ role: 'customer' }))).toBe(true);
  });

  it('denies non-matching role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === ROLES_KEY) return ['admin'];
      return undefined;
    });
    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => ({ req: { user: { role: 'customer' } } }),
    } as never);

    expect(() => guard.canActivate(contextFor({ role: 'customer' }))).toThrow(ForbiddenException);
  });
});
