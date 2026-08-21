import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKeyRateLimitGuard } from './api-key-rate-limit.guard';
import { RedisService } from '../../redis/redis.service';

describe('ApiKeyRateLimitGuard', () => {
  let guard: ApiKeyRateLimitGuard;
  let redisService: { isAvailable: jest.Mock; get: jest.Mock; set: jest.Mock };
  let configService: { get: jest.Mock };

  function contextFor(keyId = 'key-1'): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          apiKeyAuth: { keyId, storeId: 'store-1', createdBy: 'user-1' },
          ip: '127.0.0.1',
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    redisService = {
      isAvailable: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      set: jest.fn(),
    };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.rateLimit.limit') return 120;
        if (key === 'app.rateLimit.ttl') return 60000;
        return undefined;
      }),
    };
    guard = new ApiKeyRateLimitGuard(
      redisService as unknown as RedisService,
      configService as unknown as ConfigService,
    );
  });

  it('limits in-memory when Redis is unavailable without 503', async () => {
    for (let i = 0; i < 30; i += 1) {
      await expect(guard.canActivate(contextFor())).resolves.toBe(true);
    }

    try {
      await guard.canActivate(contextFor());
      fail('expected rate limit');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('uses Redis counters when available', async () => {
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('0');
    redisService.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalled();
  });
});
