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
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const set = jest.fn(() => Promise.resolve(undefined));
    const findOne = jest.fn(() => Promise.resolve(row ?? null));
    const create = jest.fn((value: unknown) => value);
    const assertFolderImageUrl = jest.fn();

    const settingsRepository = {
      findOne,
      create,
      save,
    } as unknown as Repository<Setting>;

    const get = jest.fn(() => Promise.resolve(cached ?? null));
    const redisService = {
      get,
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
      get,
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

  it('updateConfigured desktop-only upserts Setting key and overwrites Redis TTL 60', async () => {
    const { service, save, set, assertFolderImageUrl } = createService();

    const result = await service.updateConfigured({ desktopImageUrl: DESKTOP_URL });

    const expected: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: null,
    };
    expect(result).toEqual(expected);
    expect(assertFolderImageUrl).toHaveBeenCalledWith(DESKTOP_URL, LOGIN_IMAGES_FOLDER);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: expected,
      }),
    );
    expect(set).toHaveBeenCalledWith(CACHE_KEY, JSON.stringify(expected), CACHE_TTL_SECONDS);
  });

  it('replace/updateConfigured with same desktop still persists and overwrites Redis', async () => {
    const configured: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: 'Welcome',
    };
    const { service, save, set } = createService({
      row: { key: SETTINGS_KEY, value: configured },
    });

    const result = await service.updateConfigured({
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: 'Welcome',
    });

    expect(result).toEqual(configured);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: configured,
      }),
    );
    expect(set).toHaveBeenCalledWith(CACHE_KEY, JSON.stringify(configured), CACHE_TTL_SECONDS);
  });

  it('rejects invalid folder URL from assertFolderImageUrl without persisting', async () => {
    const { service, save, set, assertFolderImageUrl } = createService();
    assertFolderImageUrl.mockImplementation(() => {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY_IMAGE_URL',
        message: 'Invalid image URL',
      });
    });

    await expect(
      service.updateConfigured({ desktopImageUrl: 'https://cdn.example.com/other/x.webp' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(save).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('returns cached value on Redis hit without inventing placeholders', async () => {
    const configured: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: null,
    };
    const { service, findOne } = createService({
      cached: JSON.stringify(configured),
    });

    const result = await service.get();

    expect(result).toEqual(configured);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('clearDesktop is idempotent when already empty', async () => {
    const { service, save, set } = createService();

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

  it('clearMobile nulls mobile and retains desktop + altText', async () => {
    const configured: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: 'Welcome to SOPET',
    };
    const { service, save, set } = createService({
      row: { key: SETTINGS_KEY, value: configured },
    });

    const result = await service.clearMobile();

    expect(result).toEqual({
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: 'Welcome to SOPET',
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: {
          desktopImageUrl: DESKTOP_URL,
          mobileImageUrl: null,
          altText: 'Welcome to SOPET',
        },
      }),
    );
    expect(set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: null,
        altText: 'Welcome to SOPET',
      }),
      CACHE_TTL_SECONDS,
    );
  });

  it('clearMobile when unconfigured returns empty triple and overwrites Redis', async () => {
    const { service, save, set } = createService();

    const result = await service.clearMobile();

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

  it('fails open to DB when Redis get throws', async () => {
    const configured: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: null,
    };
    const { service, findOne, get } = createService({
      row: { key: SETTINGS_KEY, value: configured },
    });
    get.mockRejectedValueOnce(new Error('redis down'));

    const result = await service.get();

    expect(findOne).toHaveBeenCalledWith({ where: { key: SETTINGS_KEY } });
    expect(result).toEqual(configured);
  });
});
