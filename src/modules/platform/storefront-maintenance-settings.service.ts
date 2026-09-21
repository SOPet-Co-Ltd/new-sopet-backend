import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../redis/redis.service';

const SETTINGS_KEY = 'platform.storefront_maintenance';
const CACHE_KEY = 'platform:storefront_maintenance';
const CACHE_TTL_SECONDS = 60;
const CUSTOM_MESSAGE_MAX_LENGTH = 255;

export const STOREFRONT_MAINTENANCE_REASONS = [
  'MAINTENANCE',
  'NOT_READY',
  'SYSTEM_UPDATE',
  'OTHER',
] as const;

export type StorefrontMaintenanceReason = (typeof STOREFRONT_MAINTENANCE_REASONS)[number];

export type StorefrontMaintenanceValue = {
  enabled: boolean;
  reason: StorefrontMaintenanceReason | null;
  customMessage: string | null;
  untilAt: string | null;
};

export type UpdateStorefrontMaintenanceInput = {
  enabled: boolean;
  reason?: StorefrontMaintenanceReason | null;
  customMessage?: string | null;
  untilAt?: string | null;
};

const DEFAULT_VALUE: StorefrontMaintenanceValue = {
  enabled: false,
  reason: null,
  customMessage: null,
  untilAt: null,
};

function isReason(value: unknown): value is StorefrontMaintenanceReason {
  return (
    typeof value === 'string' &&
    (STOREFRONT_MAINTENANCE_REASONS as readonly string[]).includes(value)
  );
}

@Injectable()
export class StorefrontMaintenanceSettingsService {
  private readonly logger = new Logger(StorefrontMaintenanceSettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly redisService: RedisService,
  ) {}

  async get(): Promise<StorefrontMaintenanceValue> {
    const cached = await this.readCache();
    const value = cached ?? (await this.loadFromDb());

    return this.applyAutoReopen(value);
  }

  async update(input: UpdateStorefrontMaintenanceInput): Promise<StorefrontMaintenanceValue> {
    const enabled = input.enabled === true;

    if (!enabled) {
      const value: StorefrontMaintenanceValue = { ...DEFAULT_VALUE };
      await this.persistAndCache(value);
      this.logger.log('storefront maintenance disabled by admin');
      return value;
    }

    if (!isReason(input.reason)) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_REASON_REQUIRED',
        message: 'A maintenance reason is required when closing the storefront',
      });
    }

    let customMessage: string | null = null;
    if (input.reason === 'OTHER') {
      customMessage = this.requireCustomMessage(input.customMessage);
    } else {
      customMessage = this.normalizeOptionalText(input.customMessage);
    }

    const untilAt = this.normalizeUntilAt(input.untilAt, { requireFuture: true });

    const value: StorefrontMaintenanceValue = {
      enabled: true,
      reason: input.reason,
      customMessage,
      untilAt,
    };

    await this.persistAndCache(value);
    this.logger.log(
      `storefront maintenance enabled by admin (reason=${value.reason}, untilAt=${value.untilAt ?? 'none'})`,
    );
    return value;
  }

  private async loadFromDb(): Promise<StorefrontMaintenanceValue> {
    const row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    const value = this.normalizeValue(row?.value);
    await this.writeCache(value);
    return value;
  }

  private async applyAutoReopen(
    value: StorefrontMaintenanceValue,
  ): Promise<StorefrontMaintenanceValue> {
    if (!value.enabled || !value.untilAt) {
      return value;
    }

    const untilMs = Date.parse(value.untilAt);
    if (Number.isNaN(untilMs) || untilMs > Date.now()) {
      return value;
    }

    const reopened: StorefrontMaintenanceValue = { ...DEFAULT_VALUE };
    await this.persistAndCache(reopened);
    this.logger.log(`storefront maintenance auto-reopened (untilAt=${value.untilAt} elapsed)`);
    return reopened;
  }

  private requireCustomMessage(value: string | null | undefined): string {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_CUSTOM_MESSAGE_REQUIRED',
        message: 'A custom message is required when reason is OTHER',
      });
    }
    if (trimmed.length > CUSTOM_MESSAGE_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_CUSTOM_MESSAGE_TOO_LONG',
        message: `Custom message must be at most ${CUSTOM_MESSAGE_MAX_LENGTH} characters`,
      });
    }
    return trimmed;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed.length > CUSTOM_MESSAGE_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_CUSTOM_MESSAGE_TOO_LONG',
        message: `Custom message must be at most ${CUSTOM_MESSAGE_MAX_LENGTH} characters`,
      });
    }
    return trimmed;
  }

  private normalizeUntilAt(
    value: string | null | undefined,
    options: { requireFuture: boolean },
  ): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const ms = Date.parse(trimmed);
    if (Number.isNaN(ms)) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_UNTIL_INVALID',
        message: 'untilAt must be a valid ISO datetime',
      });
    }

    if (options.requireFuture && ms <= Date.now()) {
      throw new BadRequestException({
        code: 'STOREFRONT_MAINTENANCE_UNTIL_NOT_FUTURE',
        message: 'untilAt must be in the future',
      });
    }

    return new Date(ms).toISOString();
  }

  private async persistAndCache(value: StorefrontMaintenanceValue): Promise<void> {
    let row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    if (row) {
      row.value = value;
    } else {
      row = this.settingsRepository.create({
        key: SETTINGS_KEY,
        value,
        description:
          'Storefront maintenance mode — when enabled, visitors see the under-maintenance page',
      });
    }

    await this.settingsRepository.save(row);
    await this.writeCache(value);
  }

  private normalizeValue(raw: unknown): StorefrontMaintenanceValue {
    if (!raw || typeof raw !== 'object') {
      return { ...DEFAULT_VALUE };
    }

    const record = raw as Record<string, unknown>;
    const reason = isReason(record.reason) ? record.reason : null;
    const customMessage =
      typeof record.customMessage === 'string' && record.customMessage.trim()
        ? record.customMessage.trim().slice(0, CUSTOM_MESSAGE_MAX_LENGTH)
        : null;
    let untilAt: string | null = null;
    if (typeof record.untilAt === 'string' && record.untilAt.trim()) {
      const ms = Date.parse(record.untilAt);
      untilAt = Number.isNaN(ms) ? null : new Date(ms).toISOString();
    }

    return {
      enabled: record.enabled === true,
      reason,
      customMessage,
      untilAt,
    };
  }

  private async readCache(): Promise<StorefrontMaintenanceValue | undefined> {
    try {
      const cached = await this.redisService.get(CACHE_KEY);
      if (!cached) {
        return undefined;
      }
      return this.normalizeValue(JSON.parse(cached));
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${CACHE_KEY}; falling back to DB — ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async writeCache(value: StorefrontMaintenanceValue): Promise<void> {
    try {
      await this.redisService.set(CACHE_KEY, JSON.stringify(value), CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis set failed for ${CACHE_KEY} — ${(err as Error).message}`);
    }
  }
}
