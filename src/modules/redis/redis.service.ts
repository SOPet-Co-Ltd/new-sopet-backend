import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password');
    const db = this.configService.get<number>('redis.db') ?? 0;

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log(`Connected to Redis at ${host}:${port} (db ${db})`);
    } catch (err) {
      this.logger.warn(`Redis unavailable at ${host}:${port} — caching disabled until connected`);
      this.logger.debug((err as Error).message);
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  isAvailable(): boolean {
    return this.client?.status === 'ready';
  }

  getClient(): Redis {
    if (!this.client || this.client.status !== 'ready') {
      throw new Error('Redis is not connected');
    }
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isAvailable()) return null;
    return this.getClient().get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable()) return;
    const client = this.getClient();
    if (ttlSeconds) {
      await client.set(key, value, 'EX', ttlSeconds);
    } else {
      await client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.isAvailable()) return;
    await this.getClient().del(key);
  }
}
