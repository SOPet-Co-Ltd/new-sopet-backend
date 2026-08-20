import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getClientIpTracker } from '../../audit-logs/audit-request-context';
import { RedisService } from '../../redis/redis.service';

type MemoryBucket = {
  count: number;
  expiresAt: number;
};

function resolvePositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  /** Stricter than Redis default when Redis is down (spray resistance). */
  private static readonly MEMORY_FALLBACK_LIMIT = 5;
  private static readonly MEMORY_FALLBACK_TTL_MS = 60_000;
  private static readonly memoryBuckets = new Map<string, MemoryBucket>();

  private readonly logger = new Logger(AuthRateLimitGuard.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const req = gqlCtx.getContext().req as Record<string, unknown> | undefined;
    const args = gqlCtx.getArgs() as {
      input?: { phone?: string; email?: string };
      phone?: string;
      email?: string;
    };

    const phone = String(args.input?.phone ?? args.phone ?? '').trim();
    const email = String(args.input?.email ?? args.email ?? '')
      .trim()
      .toLowerCase();
    const ip = getClientIpTracker(req);
    // Prefer phone/email so loopback/proxy IPs do not share one global bucket.
    const identifier = phone || email || ip;
    const key = `rate_limit:auth:${identifier}`;
    const limit = resolvePositiveInt(
      this.configService.get<number>('app.authRateLimit.limit') ??
        this.configService.get<number>('app.rateLimit.limit'),
      10,
    );
    const ttlMs = resolvePositiveInt(
      this.configService.get<number>('app.authRateLimit.ttl') ??
        this.configService.get<number>('app.rateLimit.ttl'),
      60_000,
    );
    const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

    if (!this.redisService.isAvailable()) {
      this.logger.warn(
        `Auth rate limit Redis unavailable; enforcing in-memory fallback (${AuthRateLimitGuard.MEMORY_FALLBACK_LIMIT}/min) for ${identifier}`,
      );
      this.enforceMemoryFallback(identifier);
      return true;
    }

    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;
    const safeCount = Number.isFinite(count) ? count : 0;

    if (safeCount >= limit) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_rate_limit_exceeded',
          identifier,
          limit,
        }),
      );
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redisService.set(key, String(safeCount + 1), ttlSeconds);
    return true;
  }

  private enforceMemoryFallback(identifier: string): void {
    const key = `rate_limit:auth:memory:${identifier}`;
    const now = Date.now();
    const bucket = AuthRateLimitGuard.memoryBuckets.get(key);

    if (!bucket || bucket.expiresAt <= now) {
      AuthRateLimitGuard.memoryBuckets.set(key, {
        count: 1,
        expiresAt: now + AuthRateLimitGuard.MEMORY_FALLBACK_TTL_MS,
      });
      return;
    }

    if (bucket.count >= AuthRateLimitGuard.MEMORY_FALLBACK_LIMIT) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_rate_limit_exceeded',
          identifier,
          limit: AuthRateLimitGuard.MEMORY_FALLBACK_LIMIT,
          mode: 'memory_fallback',
        }),
      );
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    bucket.count += 1;
  }
}
