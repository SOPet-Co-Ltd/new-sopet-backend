import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

const SETTINGS_KEY = 'platform.login_page_images';
const CACHE_KEY = 'platform:login_page_images';
const CACHE_TTL_SECONDS = 60;
const LOGIN_IMAGES_FOLDER = 'login-images';
const ALT_TEXT_MAX_LENGTH = 255;

/** Public DTO for login page images Setting jsonb / GraphQL mapping. */
export type LoginPageImagesValue = {
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  altText: string | null;
};

export type UpdateLoginPageImagesConfiguredInput = {
  desktopImageUrl: string;
  mobileImageUrl?: string | null;
  altText?: string | null;
};

const EMPTY_LOGIN_PAGE_IMAGES: LoginPageImagesValue = {
  desktopImageUrl: null,
  mobileImageUrl: null,
  altText: null,
};

@Injectable()
export class LoginPageImagesSettingsService {
  private readonly logger = new Logger(LoginPageImagesSettingsService.name);

  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
  ) {}

  async get(): Promise<LoginPageImagesValue> {
    const cached = await this.readCache();
    if (cached !== undefined) {
      return cached;
    }

    const row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    const value = this.normalizeValue(row?.value);
    await this.writeCache(value);
    return value;
  }

  async updateConfigured(
    input: UpdateLoginPageImagesConfiguredInput,
  ): Promise<LoginPageImagesValue> {
    const desktopImageUrl = input.desktopImageUrl?.trim() ?? '';
    if (!desktopImageUrl) {
      this.logger.warn({ code: 'LOGIN_PAGE_IMAGES_DESKTOP_REQUIRED' });
      throw new BadRequestException({
        code: 'LOGIN_PAGE_IMAGES_DESKTOP_REQUIRED',
        message: 'Desktop image URL is required',
      });
    }

    const altText = this.normalizeOptionalText(input.altText);
    if (altText !== null && altText.length > ALT_TEXT_MAX_LENGTH) {
      this.logger.warn({ code: 'LOGIN_PAGE_IMAGES_ALT_TOO_LONG' });
      throw new BadRequestException({
        code: 'LOGIN_PAGE_IMAGES_ALT_TOO_LONG',
        message: `Alt text must be at most ${ALT_TEXT_MAX_LENGTH} characters`,
      });
    }

    this.storageService.assertFolderImageUrl(desktopImageUrl, LOGIN_IMAGES_FOLDER);

    const mobileImageUrl = this.normalizeOptionalText(input.mobileImageUrl);
    if (mobileImageUrl !== null) {
      this.storageService.assertFolderImageUrl(mobileImageUrl, LOGIN_IMAGES_FOLDER);
    }

    const value: LoginPageImagesValue = {
      desktopImageUrl,
      mobileImageUrl,
      altText,
    };

    await this.persistAndCache(value);
    this.logger.log('login page images updated');
    return value;
  }

  async clearDesktop(): Promise<LoginPageImagesValue> {
    await this.persistAndCache(EMPTY_LOGIN_PAGE_IMAGES);
    this.logger.log('login page desktop image cleared');
    return EMPTY_LOGIN_PAGE_IMAGES;
  }

  async clearMobile(): Promise<LoginPageImagesValue> {
    const current = await this.getFromDb();
    const value: LoginPageImagesValue = {
      desktopImageUrl: current.desktopImageUrl,
      mobileImageUrl: null,
      altText: current.altText,
    };

    // Unconfigured / empty desktop → full empty triple (idempotent)
    const next = value.desktopImageUrl === null ? EMPTY_LOGIN_PAGE_IMAGES : value;

    await this.persistAndCache(next);
    this.logger.log('login page mobile image cleared');
    return next;
  }

  private async getFromDb(): Promise<LoginPageImagesValue> {
    const row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    return this.normalizeValue(row?.value);
  }

  private async persistAndCache(value: LoginPageImagesValue): Promise<void> {
    let row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    if (row) {
      row.value = value;
    } else {
      row = this.settingsRepository.create({
        key: SETTINGS_KEY,
        value,
        description: 'Login page desktop/mobile images and alt text',
      });
    }

    await this.settingsRepository.save(row);
    await this.writeCache(value);
  }

  private normalizeValue(raw: unknown): LoginPageImagesValue {
    if (!raw || typeof raw !== 'object') {
      return { ...EMPTY_LOGIN_PAGE_IMAGES };
    }

    const record = raw as Record<string, unknown>;
    return {
      desktopImageUrl: this.asNullableString(record.desktopImageUrl),
      mobileImageUrl: this.asNullableString(record.mobileImageUrl),
      altText: this.asNullableString(record.altText),
    };
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
    return trimmed.length > 0 ? trimmed : null;
  }

  /** Fail-open Redis read: cache hit → DTO; miss/error → undefined (caller uses DB). */
  private async readCache(): Promise<LoginPageImagesValue | undefined> {
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

  private async writeCache(value: LoginPageImagesValue): Promise<void> {
    try {
      await this.redisService.set(CACHE_KEY, JSON.stringify(value), CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Redis set failed for ${CACHE_KEY} — ${(err as Error).message}`);
    }
  }
}
