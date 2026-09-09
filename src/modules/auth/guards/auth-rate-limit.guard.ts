import { createHash } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlExecutionContext } from '@nestjs/graphql';
import { resolveClientIp } from '../../../common/utils/client-ip.util';
import { RedisService } from '../../redis/redis.service';

/** Tight per-process fallback when Redis is down/unset (SOPET-H-01). */
const IN_MEMORY_AUTH_LIMIT = 5;
const IN_MEMORY_AUTH_WINDOW_MS = 60_000;

type InMemoryBucket = { count: number; resetAt: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Stable hash for secrets used as auth rate-limit identities (tokens). */
export function hashRateLimitIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function resolveAuthRateLimitIdentity(
  args: Record<string, unknown>,
  req: unknown,
): string | null {
  const input = isRecord(args.input) ? args.input : undefined;

  if (input && typeof input.phone === 'string' && input.phone.trim()) {
    return `phone:${input.phone.trim()}`;
  }

  const email =
    (input && typeof input.email === 'string' && input.email.trim()) ||
    (input && typeof input.ownerEmail === 'string' && input.ownerEmail.trim()) ||
    null;
  if (email) {
    return `email:${email.toLowerCase()}`;
  }

  const tokenCandidates = [
    input && typeof input.refreshToken === 'string' ? input.refreshToken : null,
    input && typeof input.token === 'string' ? input.token : null,
    input && typeof input.reactivationToken === 'string' ? input.reactivationToken : null,
    typeof args.token === 'string' ? args.token : null,
  ];
  for (const token of tokenCandidates) {
    if (token && token.trim()) {
      return `token:${hashRateLimitIdentity(token.trim())}`;
    }
  }

  const clientIp = resolveClientIp(req);
  if (clientIp) {
    return `ip:${clientIp}`;
  }

  return null;
}

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
    const req = gqlCtx.getContext<{ req?: unknown }>().req;
    const args: Record<string, unknown> = gqlCtx.getArgs();
    const operation = context.getHandler()?.name || 'unknown';

    const identity = resolveAuthRateLimitIdentity(args, req);
    if (!identity) {
      // No stable visitor identity — do not collapse all callers into one bucket.
      // Fail closed for auth endpoints (tight abuse surface).
      this.throwRateLimited();
    }

    const key = `rate_limit:auth:${operation}:${identity}`;

    if (this.redisService.isAvailable()) {
      return this.enforceRedisLimit(key);
    }

    return this.enforceInMemoryLimit(key);
  }

  private async enforceRedisLimit(key: string): Promise<boolean> {
    const limit = this.configService.get<number>('app.rateLimit.limit') ?? 100;
    const ttlMs = this.configService.get<number>('app.rateLimit.ttl') ?? 60000;
    const ttlSeconds = Math.ceil(ttlMs / 1000);

    const count = await this.redisService.incr(key, ttlSeconds);
    if (count == null) {
      return this.enforceInMemoryLimit(key);
    }

    if (count > limit) {
      this.throwRateLimited();
    }

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
