import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
  AuthRateLimitGuard,
  hashRateLimitIdentity,
  resolveAuthRateLimitIdentity,
} from './auth-rate-limit.guard';
import { RedisService } from '../../redis/redis.service';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('resolveAuthRateLimitIdentity', () => {
  it('prefers phone then email then token hash', () => {
    expect(resolveAuthRateLimitIdentity({ input: { phone: '0812345678' } }, {})).toBe(
      'phone:0812345678',
    );
    expect(resolveAuthRateLimitIdentity({ input: { email: 'A@B.com' } }, {})).toBe(
      'email:a@b.com',
    );
    expect(resolveAuthRateLimitIdentity({ input: { ownerEmail: 'Owner@B.com' } }, {})).toBe(
      'email:owner@b.com',
    );

    const token = 'reset-token-value';
    expect(resolveAuthRateLimitIdentity({ input: { token } }, {})).toBe(
      `token:${hashRateLimitIdentity(token)}`,
    );
    expect(resolveAuthRateLimitIdentity({ input: { refreshToken: token } }, {})).toBe(
      `token:${hashRateLimitIdentity(token)}`,
    );
    expect(resolveAuthRateLimitIdentity({ token }, {})).toBe(
      `token:${hashRateLimitIdentity(token)}`,
    );
  });

  it('falls back to visitor IP from x-sopet-client-ip, not missing', () => {
    expect(
      resolveAuthRateLimitIdentity(
        { input: {} },
        { headers: { 'x-sopet-client-ip': '203.0.113.10' }, ip: '10.0.0.1' },
      ),
    ).toBe('ip:203.0.113.10');
  });

  it('returns null when no identity exists', () => {
    expect(resolveAuthRateLimitIdentity({ input: {} }, { headers: {} })).toBeNull();
  });

  it('isolates refresh tokens from different users', () => {
    const a = resolveAuthRateLimitIdentity({ input: { refreshToken: 'token-a' } }, {});
    const b = resolveAuthRateLimitIdentity({ input: { refreshToken: 'token-b' } }, {});
    expect(a).not.toBe(b);
  });
});

describe('AuthRateLimitGuard', () => {
  const redisService = {
    isAvailable: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.rateLimit.limit') return 2;
      if (key === 'app.rateLimit.ttl') return 60000;
      return undefined;
    }),
  };

  let guard: AuthRateLimitGuard;
  const handler = { name: 'sendCustomerOtp' };
  const context = {
    getHandler: () => handler,
  } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AuthRateLimitGuard(
      redisService as unknown as RedisService,
      configService as unknown as ConfigService,
    );
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { ip: '127.0.0.1', headers: {} } }),
      getArgs: () => ({ input: { phone: '0812345678' } }),
    });
  });

  it('uses in-memory limiting when Redis is unavailable (does not 503)', async () => {
    redisService.isAvailable.mockReturnValue(false);

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    expect(redisService.incr).not.toHaveBeenCalled();
  });

  it('allows requests under the Redis limit with atomic incr', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.incr.mockResolvedValue(1);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.incr).toHaveBeenCalledWith(
      'rate_limit:auth:sendCustomerOtp:phone:0812345678',
      60,
    );
  });

  it('rejects when the Redis limit is exceeded', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.incr.mockResolvedValue(3);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'RATE_LIMIT_EXCEEDED' },
    });
  });

  it('scopes refreshToken by token hash so concurrent users do not share a bucket', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.incr.mockResolvedValue(1);
    handler.name = 'refreshToken';

    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { headers: {} } }),
      getArgs: () => ({ input: { refreshToken: 'user-a-refresh' } }),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);

    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { headers: {} } }),
      getArgs: () => ({ input: { refreshToken: 'user-b-refresh' } }),
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(redisService.incr).toHaveBeenNthCalledWith(
      1,
      `rate_limit:auth:refreshToken:token:${hashRateLimitIdentity('user-a-refresh')}`,
      60,
    );
    expect(redisService.incr).toHaveBeenNthCalledWith(
      2,
      `rate_limit:auth:refreshToken:token:${hashRateLimitIdentity('user-b-refresh')}`,
      60,
    );
  });

  it('rejects when identity cannot be resolved', async () => {
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { headers: {} } }),
      getArgs: () => ({ input: {} }),
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'RATE_LIMIT_EXCEEDED' },
    });
  });
});
