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
      if (key === 'app.rateLimit.limit') return 2;
      if (key === 'app.rateLimit.ttl') return 60000;
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
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { ip: '127.0.0.1' } }),
      getArgs: () => ({ input: { phone: '0812345678' } }),
    });
  });

  it('skips rate limiting when Redis is unavailable', async () => {
    redisService.isAvailable.mockReturnValue(false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.get).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
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
});
