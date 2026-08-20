import { Controller, Get, Headers, Logger, UnauthorizedException } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { Public } from '../../common/decorators';
import { isRedisConfigured } from '../../common/utils/is-redis-configured';
import { RedisService } from '../redis/redis.service';

@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check(@Headers('x-health-check-token') healthCheckToken?: string) {
    // In production, detailed /health requires the same token as /ready (BE2-007).
    if (this.isProduction()) {
      this.assertHealthCheckToken(healthCheckToken);
    }
    return this.health.check(this.buildChecks());
  }

  @Get('ready')
  @HealthCheck()
  readinessCheck(@Headers('x-health-check-token') healthCheckToken?: string) {
    this.assertHealthCheckToken(healthCheckToken);
    return this.health.check(this.buildChecks());
  }

  @Get('live')
  @HealthCheck()
  livenessCheck() {
    return { status: 'ok' };
  }

  private isProduction(): boolean {
    return this.config.get<string>('app.environment') === 'production';
  }

  private assertHealthCheckToken(providedToken?: string): void {
    const expectedToken = this.config.get<string>('app.healthCheckToken')?.trim();
    const requireToken = this.isProduction() || Boolean(expectedToken);

    if (!requireToken) {
      return;
    }

    if (!expectedToken) {
      this.logger.error('HEALTH_CHECK_TOKEN missing while production health auth is required');
      throw new UnauthorizedException({
        code: 'HEALTH_CHECK_UNAUTHORIZED',
        message: 'Invalid or missing health check token',
      });
    }

    if (providedToken !== expectedToken) {
      this.logger.warn('Rejected health request with invalid or missing health check token');
      throw new UnauthorizedException({
        code: 'HEALTH_CHECK_UNAUTHORIZED',
        message: 'Invalid or missing health check token',
      });
    }
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
