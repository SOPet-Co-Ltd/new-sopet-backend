import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { RedisService } from '../../redis/redis.service';

/** Tight per-process fallback when Redis is down/unset (SOPET-H-01). */
const IN_MEMORY_AUTH_LIMIT = 5;
const IN_MEMORY_AUTH_WINDOW_MS = 60_000;

type InMemoryBucket = { count: number; resetAt: number };

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  /** Process-local counters — not shared across instances (acceptable while Redis is optional). */
  private readonly memoryBuckets = new Map<string, InMemoryBucket>();

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const gqlCtx = GqlExecutionContext.create(context);
    const req = gqlCtx.getContext().req as {
      ip?: string;
      body?: { variables?: Record<string, unknown> };
    };
    const args = gqlCtx.getArgs();

    const identifier = args.input?.phone ?? args.input?.email ?? req.ip ?? 'unknown';
    const key = `rate_limit:auth:${identifier}`;

    if (this.redisService.isAvailable()) {
      return this.enforceRedisLimit(key);
    }

    return this.enforceInMemoryLimit(key);
  }

  private async enforceRedisLimit(key: string): Promise<boolean> {
    const limit = this.configService.get<number>('app.rateLimit.limit') ?? 100;
    const ttlMs = this.configService.get<number>('app.rateLimit.ttl') ?? 60000;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) {
      this.throwRateLimited();
    }

    await this.redisService.set(key, String(count + 1), ttlSeconds);
    return true;
  }

  private enforceInMemoryLimit(key: string): boolean {
    const now = Date.now();
    this.pruneExpiredBuckets(now);

    const existing = this.memoryBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.memoryBuckets.set(key, { count: 1, resetAt: now + IN_MEMORY_AUTH_WINDOW_MS });
      return true;
    }

    if (existing.count >= IN_MEMORY_AUTH_LIMIT) {
      this.throwRateLimited();
    }

    existing.count += 1;
    return true;
  }

  private pruneExpiredBuckets(now: number): void {
    if (this.memoryBuckets.size < 500) {
      return;
    }
    for (const [bucketKey, bucket] of this.memoryBuckets) {
      if (bucket.resetAt <= now) {
        this.memoryBuckets.delete(bucketKey);
      }
    }
  }

  private throwRateLimited(): never {
    throw new HttpException(
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
