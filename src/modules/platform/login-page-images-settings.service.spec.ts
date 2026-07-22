import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Setting } from '../../database/entities/setting.entity';
import {
  LoginPageImagesSettingsService,
  type LoginPageImagesValue,
} from './login-page-images-settings.service';

const EMPTY_LOGIN_PAGE_IMAGES: LoginPageImagesValue = {
  desktopImageUrl: null,
  mobileImageUrl: null,
  altText: null,
};

const SETTINGS_KEY = 'platform.login_page_images';
const CACHE_KEY = 'platform:login_page_images';
const CACHE_TTL_SECONDS = 60;
const LOGIN_IMAGES_FOLDER = 'login-images';

const DESKTOP_URL =
  'https://cdn.example.com/login-images/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp';
const MOBILE_URL = 'https://cdn.example.com/login-images/b2c3d4e5-f6a7-8901-bcde-f12345678901.webp';

describe('LoginPageImagesSettingsService', () => {
  const createService = ({
    row,
    cached,
  }: {
    row?: Partial<Setting> | null;
    cached?: string | null;
  } = {}) => {
    const save = jest.fn(async (value: unknown) => value);
    const set = jest.fn(async () => undefined);
    const findOne = jest.fn(async () => row ?? null);
    const create = jest.fn((value: unknown) => value);
    const assertFolderImageUrl = jest.fn();

    const settingsRepository = {
      findOne,
      create,
      save,
    } as unknown as Repository<Setting>;

    const redisService = {
      get: jest.fn(async () => cached ?? null),
      set,
    };

    const storageService = {
      assertFolderImageUrl,
    };

    return {
      service: new LoginPageImagesSettingsService(
        settingsRepository,
        redisService as never,
        storageService as never,
      ),
      findOne,
      save,
      set,
      assertFolderImageUrl,
    };
  };

  it('returns exact null triple when settings row is missing (no merge-defaults)', async () => {
    const { service, findOne } = createService();

    const result = await service.get();

    expect(findOne).toHaveBeenCalledWith({ where: { key: SETTINGS_KEY } });
    expect(result).toEqual(EMPTY_LOGIN_PAGE_IMAGES);
  });

  it('clearDesktop persists empty DTO and overwrites Redis cache', async () => {
    const configured: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: 'Welcome to SOPET',
    };
    const { service, save, set } = createService({
      row: { key: SETTINGS_KEY, value: configured },
      cached: JSON.stringify(configured),
    });

    const result = await service.clearDesktop();

    expect(result).toEqual(EMPTY_LOGIN_PAGE_IMAGES);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: EMPTY_LOGIN_PAGE_IMAGES,
      }),
    );
    expect(set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(EMPTY_LOGIN_PAGE_IMAGES),
      CACHE_TTL_SECONDS,
    );
  });

  it('rejects updateConfigured without desktop with LOGIN_PAGE_IMAGES_DESKTOP_REQUIRED', async () => {
    const { service } = createService();

    await expect(
      service.updateConfigured({ desktopImageUrl: '   ', mobileImageUrl: null, altText: null }),
    ).rejects.toMatchObject({
      response: { code: 'LOGIN_PAGE_IMAGES_DESKTOP_REQUIRED' },
    });
    await expect(
      service.updateConfigured({ desktopImageUrl: '', mobileImageUrl: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects altText longer than 255 with LOGIN_PAGE_IMAGES_ALT_TOO_LONG', async () => {
    const { service } = createService();
    const tooLongAlt = 'a'.repeat(256);

    await expect(
      service.updateConfigured({
        desktopImageUrl: DESKTOP_URL,
        altText: tooLongAlt,
      }),
    ).rejects.toMatchObject({
      response: { code: 'LOGIN_PAGE_IMAGES_ALT_TOO_LONG' },
    });
  });

  it('calls assertFolderImageUrl with folder login-images on updateConfigured', async () => {
    const { service, assertFolderImageUrl } = createService();

    await service.updateConfigured({
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: 'Login',
    });

    expect(assertFolderImageUrl).toHaveBeenCalledWith(DESKTOP_URL, LOGIN_IMAGES_FOLDER);
    expect(assertFolderImageUrl).toHaveBeenCalledWith(MOBILE_URL, LOGIN_IMAGES_FOLDER);
  });
});
