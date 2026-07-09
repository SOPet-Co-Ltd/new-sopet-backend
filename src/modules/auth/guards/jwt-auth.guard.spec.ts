import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../../common/decorators';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;

  function contextFor(): ExecutionContext {
    return {
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  function mockPublicRoute(isPublic: boolean): void {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) {
        return isPublic;
      }
      return undefined;
    });
  }

  describe('handleRequest', () => {
    it('returns the user on public routes when authenticated', () => {
      mockPublicRoute(true);
      const user = { id: 'cust-1', role: 'customer' };

      expect(guard.handleRequest(null, user, null, contextFor())).toBe(user);
    });

    it('allows anonymous access on public routes without a user', () => {
      mockPublicRoute(true);

      expect(guard.handleRequest(null, null, null, contextFor())).toBeNull();
    });

    it('allows anonymous access on public routes when token validation fails', () => {
      mockPublicRoute(true);

      expect(guard.handleRequest(new Error('jwt expired'), null, null, contextFor())).toBeNull();
    });

    it('requires authentication on protected routes', () => {
      mockPublicRoute(false);

      expect(() => guard.handleRequest(null, null, null, contextFor())).toThrow(
        UnauthorizedException,
      );
    });

    it('returns the user on protected routes when authenticated', () => {
      mockPublicRoute(false);
      const user = { id: 'cust-1', role: 'customer' };

      expect(guard.handleRequest(null, user, null, contextFor())).toBe(user);
    });
  });
});
