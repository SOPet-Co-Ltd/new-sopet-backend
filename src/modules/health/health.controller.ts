import { Controller, Get, Logger } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
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
    return this.health.check([
      async () => this.db.pingCheck('database', { timeout: 5000 }),
      async () => {
        try {
          const client = this.redis.getClient();
          await client.ping();
          return { redis: { status: 'up' } };
        } catch {
          throw new Error('Redis ping failed');
        }
      },
    ]);
  }

  @Get('ready')
  @HealthCheck()
  readinessCheck() {
    return this.health.check([
      async () => this.db.pingCheck('database', { timeout: 5000 }),
      async () => {
        try {
          const client = this.redis.getClient();
          await client.ping();
          return { redis: { status: 'up' } };
        } catch {
          throw new Error('Redis ping failed');
        }
      },
    ]);
  }

  @Get('live')
  @HealthCheck()
  livenessCheck() {
    return { status: 'ok' };
  }
}
