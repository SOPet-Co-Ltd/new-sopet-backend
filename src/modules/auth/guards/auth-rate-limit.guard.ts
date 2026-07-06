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

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
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
      return true;
    }

    const current = await this.redisService.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) {
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
}
