import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { RedisService } from '../../redis/redis.service';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('AuthRateLimitGuard', () => {
  const redisService = {
    isAvailable: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'app.authRateLimit.limit') return 2;
      if (key === 'app.authRateLimit.ttl') return 60000;
      return undefined;
    }),
  };

  const guard = new AuthRateLimitGuard(
    redisService as unknown as RedisService,
    configService as unknown as ConfigService,
  );

  const context = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (
      AuthRateLimitGuard as unknown as {
        memoryBuckets: Map<string, { count: number; expiresAt: number }>;
      }
    ).memoryBuckets.clear();
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({
        req: {
          ip: '127.0.0.1',
          headers: { 'x-sopet-client-ip': '203.0.113.10' },
        },
      }),
      getArgs: () => ({ input: { phone: '0812345678' } }),
    });
  });

  it('uses in-memory fallback keyed by phone when Redis is unavailable', async () => {
    redisService.isAvailable.mockReturnValue(false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'RATE_LIMIT_EXCEEDED' },
    });
    expect(redisService.get).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('does not share memory buckets across different emails behind the same proxy IP', async () => {
    redisService.isAvailable.mockReturnValue(false);

    for (let i = 0; i < 5; i += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({
        req: {
          ip: '127.0.0.1',
          headers: { 'x-sopet-client-ip': '203.0.113.10' },
        },
      }),
      getArgs: () => ({ input: { email: 'other@example.com' } }),
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows requests under the limit', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('0');
    redisService.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalledWith('rate_limit:auth:0812345678', '1', 60);
  });

  it('rejects when the limit is exceeded', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('2');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'RATE_LIMIT_EXCEEDED' },
    });
  });

  it('falls back to a positive default when configured limit is NaN', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.authRateLimit.limit') return Number.NaN;
      if (key === 'app.authRateLimit.ttl') return 60000;
      return undefined;
    });
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('9');
    redisService.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // Default limit is 10; count 9 is under limit so set → 10.
    expect(redisService.set).toHaveBeenCalledWith('rate_limit:auth:0812345678', '10', 60);

    // Restore defaults for isolation if other tests are added later.
    configService.get.mockImplementation((key: string) => {
      if (key === 'app.authRateLimit.limit') return 2;
      if (key === 'app.authRateLimit.ttl') return 60000;
      return undefined;
    });
  });
});
