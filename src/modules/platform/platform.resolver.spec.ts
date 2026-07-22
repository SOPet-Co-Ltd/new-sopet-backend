import 'reflect-metadata';
import { PlatformResolver } from './platform.resolver';
import { PlatformService } from './platform.service';
import { LoginPageImagesSettingsService } from './login-page-images-settings.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UpdateLoginPageImagesInput } from './login-page-images.inputs';

describe('PlatformResolver login page images', () => {
  let platformService: jest.Mocked<Pick<PlatformService, 'getSettings'>>;
  let loginPageImagesSettingsService: jest.Mocked<
    Pick<
      LoginPageImagesSettingsService,
      'get' | 'updateConfigured' | 'clearDesktop' | 'clearMobile'
    >
  >;
  let resolver: PlatformResolver;

  beforeEach(() => {
    platformService = {
      getSettings: jest.fn(),
    };
    loginPageImagesSettingsService = {
      get: jest.fn(),
      updateConfigured: jest.fn(),
      clearDesktop: jest.fn(),
      clearMobile: jest.fn(),
    };
    resolver = new PlatformResolver(
      platformService as unknown as PlatformService,
      loginPageImagesSettingsService as unknown as LoginPageImagesSettingsService,
    );
  });

  describe('loginPageImages', () => {
    it('is decorated with @Public()', () => {
      const method = Object.getOwnPropertyDescriptor(PlatformResolver.prototype, 'loginPageImages')
        ?.value as (...args: unknown[]) => unknown;
      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, method) as boolean | undefined;
      expect(isPublic).toBe(true);
    });

    it('returns configured desktop URL and null mobile (AC-003–004)', async () => {
      loginPageImagesSettingsService.get.mockResolvedValue({
        desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
        mobileImageUrl: null,
        altText: 'Login hero',
      });

      const result = await resolver.loginPageImages();

      expect(result).toEqual({
        desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
        mobileImageUrl: null,
        altText: 'Login hero',
      });
      expect(loginPageImagesSettingsService.get).toHaveBeenCalled();
    });

    it('returns empty null triple when unconfigured', async () => {
      loginPageImagesSettingsService.get.mockResolvedValue({
        desktopImageUrl: null,
        mobileImageUrl: null,
        altText: null,
      });

      const result = await resolver.loginPageImages();

      expect(result).toEqual({
        desktopImageUrl: null,
        mobileImageUrl: null,
        altText: null,
      });
    });
  });

  describe('updateLoginPageImages', () => {
    it('is gated with @Roles(admin)', () => {
      const method = Object.getOwnPropertyDescriptor(
        PlatformResolver.prototype,
        'updateLoginPageImages',
      )?.value as (...args: unknown[]) => unknown;
      const roles = Reflect.getMetadata(ROLES_KEY, method) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });

    it('maps service DTO after configured update', async () => {
      const input: UpdateLoginPageImagesInput = {
        desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
        mobileImageUrl: 'https://cdn.example/login-images/mobile.png',
        altText: 'Alt',
      };
      loginPageImagesSettingsService.updateConfigured.mockResolvedValue({
        desktopImageUrl: input.desktopImageUrl,
        mobileImageUrl: input.mobileImageUrl!,
        altText: input.altText!,
      });

      const result = await resolver.updateLoginPageImages(input);

      expect(loginPageImagesSettingsService.updateConfigured).toHaveBeenCalledWith(input);
      expect(result).toEqual({
        desktopImageUrl: input.desktopImageUrl,
        mobileImageUrl: input.mobileImageUrl,
        altText: input.altText,
      });
    });
  });

  describe('clearLoginPageDesktopImage', () => {
    it('is gated with @Roles(admin)', () => {
      const method = Object.getOwnPropertyDescriptor(
        PlatformResolver.prototype,
        'clearLoginPageDesktopImage',
      )?.value as (...args: unknown[]) => unknown;
      const roles = Reflect.getMetadata(ROLES_KEY, method) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });

    it('returns full empty triple from clearDesktop', async () => {
      loginPageImagesSettingsService.clearDesktop.mockResolvedValue({
        desktopImageUrl: null,
        mobileImageUrl: null,
        altText: null,
      });

      const result = await resolver.clearLoginPageDesktopImage();

      expect(result).toEqual({
        desktopImageUrl: null,
        mobileImageUrl: null,
        altText: null,
      });
    });
  });

  describe('clearLoginPageMobileImage', () => {
    it('is gated with @Roles(admin)', () => {
      const method = Object.getOwnPropertyDescriptor(
        PlatformResolver.prototype,
        'clearLoginPageMobileImage',
      )?.value as (...args: unknown[]) => unknown;
      const roles = Reflect.getMetadata(ROLES_KEY, method) as string[] | undefined;
      expect(roles).toEqual(['admin']);
    });

    it('returns mobile null with desktop retained', async () => {
      loginPageImagesSettingsService.clearMobile.mockResolvedValue({
        desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
        mobileImageUrl: null,
        altText: 'Kept',
      });

      const result = await resolver.clearLoginPageMobileImage();

      expect(result).toEqual({
        desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
        mobileImageUrl: null,
        altText: 'Kept',
      });
    });
  });

  describe('PlatformSettingsType isolation', () => {
    it('does not route login images through platformSettings', () => {
      platformService.getSettings.mockReturnValue({
        storefrontUrl: 'https://store.example',
        currency: 'THB',
        supportEmail: 'support@example.com',
      });

      const settings = resolver.platformSettings();
      expect(settings).toEqual({
        storefrontUrl: 'https://store.example',
        currency: 'THB',
        supportEmail: 'support@example.com',
      });
      expect(settings).not.toHaveProperty('desktopImageUrl');
      expect(loginPageImagesSettingsService.get).not.toHaveBeenCalled();
    });
  });

  describe('UpdateLoginPageImagesInput contract', () => {
    it('rejects missing desktopImageUrl via class-validator (AC-010 String!)', async () => {
      const { validate } = await import('class-validator');
      const input = new UpdateLoginPageImagesInput();
      input.mobileImageUrl = 'https://cdn.example/login-images/mobile.png';
      input.altText = 'x';

      const errors = await validate(input);
      const desktopError = errors.find((e) => e.property === 'desktopImageUrl');
      expect(desktopError).toBeDefined();
    });

    it('accepts retained desktop with optional mobile (no omit-desktop patch)', async () => {
      const { validate } = await import('class-validator');
      const input = new UpdateLoginPageImagesInput();
      input.desktopImageUrl = 'https://cdn.example/login-images/desktop.png';
      input.mobileImageUrl = 'https://cdn.example/login-images/mobile.png';
      input.altText = 'ok';

      const errors = await validate(input);
      expect(errors).toHaveLength(0);
    });
  });
});
