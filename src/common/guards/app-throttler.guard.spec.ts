import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AppThrottlerGuard } from './app-throttler.guard';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('AppThrottlerGuard', () => {
  it('reads req/res from GraphQL context', () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
    const req = { ip: '203.0.113.10', headers: {} };
    const res = { header: jest.fn() };

    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req, res }),
    });

    const context = {
      getType: () => 'graphql',
    } as unknown as ExecutionContext;

    const result = (
      guard as unknown as {
        getRequestResponse: (ctx: ExecutionContext) => { req: unknown; res: unknown };
      }
    ).getRequestResponse(context);

    expect(result.req).toBe(req);
    expect(result.res).toBe(res);
  });

  it('falls back when GraphQL context has no req', () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;

    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({}),
    });

    const context = {
      getType: () => 'graphql',
    } as unknown as ExecutionContext;

    const result = (
      guard as unknown as {
        getRequestResponse: (ctx: ExecutionContext) => {
          req: { ip?: string };
          res: { header: (k: string, v: string) => void };
        };
      }
    ).getRequestResponse(context);

    expect(result.req.ip).toBe('unknown');
    expect(() => result.res.header('X-RateLimit-Limit', 1)).not.toThrow();
  });

  it('tracks GraphQL requests by BFF client IP when req.ip is loopback', async () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
    const req = {
      ip: '127.0.0.1',
      headers: { 'x-sopet-client-ip': '203.0.113.55' },
    };

    const tracker = await (
      guard as unknown as {
        getTracker: (req: {
          ip?: string;
          headers?: Record<string, string>;
        }) => Promise<string>;
      }
    ).getTracker(req);

    expect(tracker).toBe('203.0.113.55');
  });
});
