import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../redis/redis.service';

const SETTINGS_KEY = 'payment.bank_transfer';
const CACHE_KEY = 'payment:bank_transfer';
const CACHE_TTL_SECONDS = 60;
const FIELD_MAX_LENGTH = 255;

export type BankTransferSettingsValue = {
  enabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName: string | null;
};

export type UpdateBankTransferSettingsInput = {
  enabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName?: string | null;
};

const EMPTY_BANK_TRANSFER: BankTransferSettingsValue = {
  enabled: false,
  bankName: '',
  accountName: '',
  accountNumber: '',
  branchName: null,
};

@Injectable()
export class BankTransferSettingsService {
  private readonly logger = new Logger(BankTransferSettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly redisService: RedisService,
  ) {}

  /** Admin form — may be incomplete / empty. */
  async get(): Promise<BankTransferSettingsValue> {
    const cached = await this.readCache();
    if (cached !== undefined) {
      return cached;
    }

    const row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    const value = this.normalizeValue(row?.value);
    await this.writeCache(value);
    return value;
  }

  isComplete(value: BankTransferSettingsValue): boolean {
    return Boolean(value.bankName && value.accountName && value.accountNumber);
  }

  /** Storefront shows the method only when enabled + account details are complete. */
  isAvailable(value: BankTransferSettingsValue): boolean {
    return value.enabled === true && this.isComplete(value);
  }

  async isAvailableNow(): Promise<boolean> {
    return this.isAvailable(await this.get());
  }

  /** Storefront / createCharge — requires enabled + complete bank details. */
  async getConfigured(): Promise<BankTransferSettingsValue> {
    const value = await this.get();
    if (!this.isAvailable(value)) {
      throw new BadRequestException({
        code: 'BANK_TRANSFER_NOT_CONFIGURED',
        message: 'Bank transfer is disabled or details are not configured',
      });
    }
    return value;
  }

  async update(input: UpdateBankTransferSettingsInput): Promise<BankTransferSettingsValue> {
    const bankName = this.requireTrimmed(input.bankName, 'bankName');
    const accountName = this.requireTrimmed(input.accountName, 'accountName');
    const accountNumber = this.requireTrimmed(input.accountNumber, 'accountNumber');
    const branchName = this.normalizeOptionalText(input.branchName);

    const value: BankTransferSettingsValue = {
      enabled: input.enabled === true,
      bankName,
      accountName,
      accountNumber,
      branchName,
    };

    await this.persistAndCache(value);
    this.logger.log(`bank transfer details updated by admin (enabled=${value.enabled})`);
    return value;
  }

  private requireTrimmed(value: string | undefined, field: string): string {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
      throw new BadRequestException({
        code: 'BANK_TRANSFER_FIELD_REQUIRED',
        message: `${field} is required`,
      });
    }
    if (trimmed.length > FIELD_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'BANK_TRANSFER_FIELD_TOO_LONG',
        message: `${field} must be at most ${FIELD_MAX_LENGTH} characters`,
      });
    }
    return trimmed;
  }

  private async persistAndCache(value: BankTransferSettingsValue): Promise<void> {
    let row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    if (row) {
      row.value = value;
    } else {
      row = this.settingsRepository.create({
        key: SETTINGS_KEY,
        value,
        description: 'SOPET official bank account for direct bank transfer payments',
      });
    }

    await this.settingsRepository.save(row);
    await this.writeCache(value);
  }

  private normalizeValue(raw: unknown): BankTransferSettingsValue {
    if (!raw || typeof raw !== 'object') {
      return { ...EMPTY_BANK_TRANSFER };
    }

    const record = raw as Record<string, unknown>;
    return {
      // Default off — missing/undefined enabled means hidden on storefront.
      enabled: record.enabled === true,
      bankName: this.asString(record.bankName),
      accountName: this.asString(record.accountName),
      accountNumber: this.asString(record.accountNumber),
      branchName: this.asNullableString(record.branchName),
    };
  }

  private asString(value: unknown): string {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim();
  }

  private asNullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeOptionalText(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length > FIELD_MAX_LENGTH) {
      throw new BadRequestException({
        code: 'BANK_TRANSFER_FIELD_TOO_LONG',
        message: `branchName must be at most ${FIELD_MAX_LENGTH} characters`,
      });
    }
    return trimmed.length > 0 ? trimmed : null;
  }

  private async readCache(): Promise<BankTransferSettingsValue | undefined> {
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

  private async writeCache(value: BankTransferSettingsValue): Promise<void> {
    try {
      await this.redisService.set(CACHE_KEY, JSON.stringify(value), CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis set failed for ${CACHE_KEY} — ${(err as Error).message}`);
    }
  }
}
