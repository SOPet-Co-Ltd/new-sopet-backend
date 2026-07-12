import { Controller, Get, Logger } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly db: TypeOrmHealthIndicator,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check(this.buildChecks());
  }

  @Get('ready')
  @HealthCheck()
  readinessCheck() {
    return this.health.check(this.buildChecks());
  }

  @Get('live')
  @HealthCheck()
  livenessCheck() {
    return { status: 'ok' };
  }

  private buildChecks(): Array<() => Promise<HealthIndicatorResult>> {
    const checks: Array<() => Promise<HealthIndicatorResult>> = [
      async () => this.db.pingCheck('database', { timeout: 5000 }),
    ];

    if (isRedisConfigured()) {
      checks.push(async () => this.checkRedis());
    }

    return checks;
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      const client = this.redis.getClient();
      await client.ping();
      return { redis: { status: 'up' } };
    } catch {
      throw new Error('Redis ping failed');
    }
  }
}
