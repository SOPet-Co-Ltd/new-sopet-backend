import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  AppThrottlerGuard,
  readJwtSubFromAuthorization,
  readSessionIdFromRequest,
  resolveThrottleTracker,
  SESSION_ID_HEADER,
} from './app-throttler.guard';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('resolveThrottleTracker', () => {
  it('prefers authenticated user id over session and IP', () => {
    expect(
      resolveThrottleTracker({
        user: { id: 'user-1' },
        headers: {
          [SESSION_ID_HEADER]: 'session-1',
          'x-sopet-client-ip': '203.0.113.10',
        },
      }),
    ).toBe('user:user-1');
  });

  it('reads JWT sub from Authorization when user is not populated yet', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'jwt-user' })).toString('base64url');
    const token = `hdr.${payload}.sig`;

    expect(
      resolveThrottleTracker({
        headers: {
          authorization: `Bearer ${token}`,
          [SESSION_ID_HEADER]: 'session-1',
        },
      }),
    ).toBe('user:jwt-user');
  });

  it('falls back to session id from header', () => {
    expect(
      resolveThrottleTracker({
        headers: {
          [SESSION_ID_HEADER]: 'session-abc',
          'x-sopet-client-ip': '203.0.113.10',
        },
      }),
    ).toBe('session:session-abc');
  });

  it('reads sessionId from GraphQL variables', () => {
    expect(
      resolveThrottleTracker({
        headers: {},
        body: { variables: { sessionId: 'guest-session' } },
      }),
    ).toBe('session:guest-session');
  });

  it('falls back to visitor IP from x-sopet-client-ip', () => {
    expect(
      resolveThrottleTracker({
        headers: { 'x-sopet-client-ip': '203.0.113.10' },
        ip: '10.0.0.1',
      }),
    ).toBe('ip:203.0.113.10');
  });

  it('returns null instead of unknown when no identity exists', () => {
    expect(resolveThrottleTracker({ headers: {} })).toBeNull();
  });

  it('isolates two visitors by client IP', () => {
    const a = resolveThrottleTracker({ headers: { 'x-sopet-client-ip': '203.0.113.1' } });
    const b = resolveThrottleTracker({ headers: { 'x-sopet-client-ip': '203.0.113.2' } });
    expect(a).not.toBe(b);
  });
});

describe('readJwtSubFromAuthorization / readSessionIdFromRequest', () => {
  it('returns null for malformed Authorization', () => {
    expect(readJwtSubFromAuthorization('Bearer not-a-jwt')).toBeNull();
    expect(readJwtSubFromAuthorization(null)).toBeNull();
  });

  it('reads nested input.sessionId', () => {
    expect(
      readSessionIdFromRequest({
        headers: {},
        body: { variables: { input: { sessionId: 'nested-session' } } },
      }),
    ).toBe('nested-session');
  });
});

describe('AppThrottlerGuard', () => {
  it('reads req/res from GraphQL context without inventing unknown IP', () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
    const req = { headers: { 'x-sopet-client-ip': '203.0.113.10' } };
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
          res: { header: (k: string, v: string | number) => void };
        };
        getTracker: (req: Record<string, unknown>) => Promise<string>;
      }
    ).getRequestResponse(context);

    expect(result.req.ip).toBeUndefined();
    expect(() => result.res.header('X-RateLimit-Limit', 1)).not.toThrow();
  });

  it('getTracker returns empty string when identity is missing', async () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard;
    const tracker = await (
      guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }
    ).getTracker({ headers: {} });
    expect(tracker).toBe('');
  });
});
