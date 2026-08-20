import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getClientIpTracker } from '../../audit-logs/audit-request-context';
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

  private readonly logger = new Logger(GuestOrderLookupRateLimitGuard.name);

  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const req = gqlCtx.getContext().req as Record<string, unknown> | undefined;
    const args: {
      orderNumber?: string;
      input?: { guestPhone?: string; orderId?: string };
    } = gqlCtx.getArgs();
    const fieldName = String(gqlCtx.getInfo().fieldName);

    const ip = getClientIpTracker(req);
    let keySuffix = '';

    if (fieldName === 'orderTracking') {
      keySuffix = String(args.orderNumber ?? '').trim();
    } else if (fieldName === 'confirmGuestOrderDelivered') {
      keySuffix = normalizeThaiPhoneToLocal(args.input?.guestPhone);
    }

    // Empty suffix still rate-limits by IP (BE2-011) — do not bypass.
    const key = `rate_limit:guest_order_lookup:${ip}:${keySuffix || '_empty'}`;

    if (this.redisService.isAvailable()) {
      await this.enforceRedisLimit(key, ip, fieldName);
      return true;
    }

    this.enforceMemoryLimit(key, ip, fieldName);
    return true;
  }

  private async enforceRedisLimit(key: string, ip: string, fieldName: string): Promise<void> {
    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= GuestOrderLookupRateLimitGuard.REDIS_LIMIT) {
      this.throwRateLimited(ip, fieldName);
    }

    await this.redisService.set(key, String(count + 1), GuestOrderLookupRateLimitGuard.TTL_SECONDS);
  }

  private enforceMemoryLimit(key: string, ip: string, fieldName: string): void {
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
      this.throwRateLimited(ip, fieldName);
    }

    bucket.count += 1;
  }

  private throwRateLimited(ip: string, fieldName: string): never {
    this.logger.warn(
      JSON.stringify({
        event: 'guest_order_lookup_rate_limited',
        ip,
        fieldName,
      }),
    );
    throw new HttpException(
      {
        code: 'GUEST_ORDER_LOOKUP_RATE_LIMITED',
        message: 'Too many guest order lookup attempts. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
