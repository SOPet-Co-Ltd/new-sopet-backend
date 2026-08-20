import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../../../common/decorators';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  const guard = new RolesGuard(reflector);

  function buildContext(user?: { role: string }): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows when no roles are required', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(undefined);

    expect(guard.canActivate(buildContext())).toBe(true);
  });

  it('throws UnauthorizedException when user is missing', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['admin']);

    expect(() => guard.canActivate(buildContext())).toThrow(UnauthorizedException);
  });

  it('throws ForbiddenException when role does not match', () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(['admin']);

    expect(() => guard.canActivate(buildContext({ role: 'customer' }))).toThrow(ForbiddenException);
  });

  it('allows when user has a required role', () => {
    const getAllAndOverride = jest.fn().mockReturnValue(['vendor', 'admin']);
    reflector.getAllAndOverride = getAllAndOverride;

    expect(guard.canActivate(buildContext({ role: 'vendor' }))).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });
});
