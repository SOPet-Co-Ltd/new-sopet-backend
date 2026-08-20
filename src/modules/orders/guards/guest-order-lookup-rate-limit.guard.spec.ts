import { HttpException, HttpStatus } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { GuestOrderLookupRateLimitGuard } from './guest-order-lookup-rate-limit.guard';
import { RedisService } from '../../redis/redis.service';

jest.mock('@nestjs/graphql', () => ({
  GqlExecutionContext: {
    create: jest.fn(),
  },
}));

describe('GuestOrderLookupRateLimitGuard', () => {
  const redisService = {
    isAvailable: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  };

  const guard = new GuestOrderLookupRateLimitGuard(redisService as unknown as RedisService);
  const context = {} as never;

  beforeEach(() => {
    jest.clearAllMocks();
    (
      GuestOrderLookupRateLimitGuard as unknown as { memoryBuckets: Map<string, unknown> }
    ).memoryBuckets?.clear?.();
    // Clear static map between tests
    (
      GuestOrderLookupRateLimitGuard as unknown as {
        memoryBuckets: Map<string, { count: number; expiresAt: number }>;
      }
    ).memoryBuckets.clear();
  });

  function mockGqlContext(fieldName: string, args: Record<string, unknown>): void {
    (GqlExecutionContext.create as jest.Mock).mockReturnValue({
      getContext: () => ({ req: { ip: '127.0.0.1' } }),
      getArgs: () => args,
      getInfo: () => ({ fieldName }),
    });
  }

  it('allows orderTracking under the Redis limit', async () => {
    mockGqlContext('orderTracking', { orderNumber: 'ORD-TEST-001' });
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('2');
    redisService.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalledWith(
      'rate_limit:guest_order_lookup:127.0.0.1:ORD-TEST-001',
      '3',
      900,
    );
  });

  it('rejects orderTracking when the Redis limit is exceeded', async () => {
    mockGqlContext('orderTracking', { orderNumber: 'ORD-TEST-001' });
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('5');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'GUEST_ORDER_LOOKUP_RATE_LIMITED' },
    });
  });

  it('keys confirmGuestOrderDelivered on normalized phone', async () => {
    mockGqlContext('confirmGuestOrderDelivered', { input: { guestPhone: '+66812345678' } });
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('0');
    redisService.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(redisService.set).toHaveBeenCalledWith(
      'rate_limit:guest_order_lookup:127.0.0.1:0812345678',
      '1',
      900,
    );
  });

  it('uses in-memory fallback with lower limits when Redis is unavailable', async () => {
    mockGqlContext('orderTracking', { orderNumber: 'ORD-MEM-001' });
    redisService.isAvailable.mockReturnValue(false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'GUEST_ORDER_LOOKUP_RATE_LIMITED' },
    });
    expect(redisService.get).not.toHaveBeenCalled();
  });

  it('rate-limits empty orderNumber by IP instead of bypassing', async () => {
    mockGqlContext('orderTracking', { orderNumber: '   ' });
    redisService.isAvailable.mockReturnValue(true);
    redisService.get.mockResolvedValue('5');

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: { code: 'GUEST_ORDER_LOOKUP_RATE_LIMITED' },
    });
    expect(redisService.get).toHaveBeenCalledWith('rate_limit:guest_order_lookup:127.0.0.1:_empty');
  });
});
