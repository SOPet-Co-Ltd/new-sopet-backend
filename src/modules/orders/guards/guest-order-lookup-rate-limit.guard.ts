import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RedisService } from '../../redis/redis.service';
import { normalizeThaiPhoneToLocal } from '../../../common/utils/phone.util';

type MemoryBucket = {
  count: number;
  expiresAt: number;
};

@Injectable()
export class GuestOrderLookupRateLimitGuard implements CanActivate {
  private static readonly memoryBuckets = new Map<string, MemoryBucket>();

  private static readonly REDIS_LIMIT = 5;
  private static readonly MEMORY_LIMIT = 3;
  private static readonly TTL_SECONDS = 15 * 60;

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const req = gqlCtx.getContext().req as { ip?: string };
    const args = gqlCtx.getArgs() as {
      orderNumber?: string;
      input?: { guestPhone?: string; orderId?: string };
    };
    const fieldName = gqlCtx.getInfo().fieldName as string;

    const ip = req.ip ?? 'unknown';
    let keySuffix = '';

    if (fieldName === 'orderTracking') {
      keySuffix = String(args.orderNumber ?? '').trim();
    } else if (fieldName === 'confirmGuestOrderDelivered') {
      keySuffix = normalizeThaiPhoneToLocal(args.input?.guestPhone);
    }

    if (!keySuffix) {
      return true;
    }

    const key = `rate_limit:guest_order_lookup:${ip}:${keySuffix}`;

    if (this.redisService.isAvailable()) {
      await this.enforceRedisLimit(key);
      return true;
    }

    this.enforceMemoryLimit(key);
    return true;
  }

  private async enforceRedisLimit(key: string): Promise<void> {
    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= GuestOrderLookupRateLimitGuard.REDIS_LIMIT) {
      this.throwRateLimited();
    }

    await this.redisService.set(key, String(count + 1), GuestOrderLookupRateLimitGuard.TTL_SECONDS);
  }

  private enforceMemoryLimit(key: string): void {
    const now = Date.now();
    const bucket = GuestOrderLookupRateLimitGuard.memoryBuckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      GuestOrderLookupRateLimitGuard.memoryBuckets.set(key, {
        count: 1,
        expiresAt: now + GuestOrderLookupRateLimitGuard.TTL_SECONDS * 1000,
      });
      return;
    }

    if (bucket.count >= GuestOrderLookupRateLimitGuard.MEMORY_LIMIT) {
      this.throwRateLimited();
    }

    bucket.count += 1;
  }

  private throwRateLimited(): never {
    throw new HttpException(
      {
        code: 'GUEST_ORDER_LOOKUP_RATE_LIMITED',
        message: 'Too many guest order lookup attempts. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
