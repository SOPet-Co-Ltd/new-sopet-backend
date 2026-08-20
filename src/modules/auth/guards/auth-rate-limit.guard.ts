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
import { RedisService } from '../../redis/redis.service';

type MemoryBucket = {
  count: number;
  expiresAt: number;
};

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
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
    const req = gqlCtx.getContext().req as {
      ip?: string;
      body?: { variables?: Record<string, unknown> };
    };
    const args = gqlCtx.getArgs();

    const identifier = args.input?.phone ?? args.input?.email ?? req.ip ?? 'unknown';
    const key = `rate_limit:auth:${identifier}`;
    const limit = this.configService.get<number>('app.rateLimit.limit') ?? 100;
    const ttlMs = this.configService.get<number>('app.rateLimit.ttl') ?? 60000;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    if (!this.redisService.isAvailable()) {
      const ip = req.ip ?? 'unknown';
      this.logger.warn(
        `Auth rate limit Redis unavailable; enforcing in-memory fallback (5/min per IP) for ${ip}`,
      );
      this.enforceMemoryFallback(ip);
      return true;
    }

    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) {
      this.logger.warn(
        JSON.stringify({
          event: 'auth_rate_limit_exceeded',
          identifier: String(identifier),
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

    await this.redisService.set(key, String(count + 1), ttlSeconds);
    return true;
  }

  private enforceMemoryFallback(ip: string): void {
    const key = `rate_limit:auth:memory:${ip}`;
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
          identifier: ip,
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
