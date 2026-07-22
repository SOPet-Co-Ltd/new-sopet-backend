import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';

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

/**
 * Red-phase compile stub — Green implementation is backend-task-03/04.
 * Methods reject so unit specs fail for missing behavior (not silently skip).
 */
@Injectable()
export class LoginPageImagesSettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly redisService: RedisService,
    private readonly storageService: StorageService,
  ) {}

  get(): Promise<LoginPageImagesValue> {
    return Promise.reject(new Error('Not implemented'));
  }

  updateConfigured(input: UpdateLoginPageImagesConfiguredInput): Promise<LoginPageImagesValue> {
    void input;
    return Promise.reject(new Error('Not implemented'));
  }

  clearDesktop(): Promise<LoginPageImagesValue> {
    return Promise.reject(new Error('Not implemented'));
  }

  clearMobile(): Promise<LoginPageImagesValue> {
    return Promise.reject(new Error('Not implemented'));
  }
}
