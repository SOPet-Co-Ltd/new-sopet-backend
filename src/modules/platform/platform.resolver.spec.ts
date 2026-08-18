import 'reflect-metadata';
import { PlatformResolver } from './platform.resolver';
import { PlatformService } from './platform.service';
import { LoginPageImagesSettingsService } from './login-page-images-settings.service';
import { BankTransferSettingsService } from './bank-transfer-settings.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { UpdateLoginPageImagesInput } from './login-page-images.inputs';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const ENTITY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-platform-1', headers: { 'x-forwarded-for': '203.0.113.10' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

function bannerEntity() {
  return {
    id: ENTITY_ID,
    title: 'Hero',
    imageUrl: 'https://cdn.example/banner.png',
    mobileImageUrl: null,
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
  };
}

function sponsorEntity() {
  return {
    id: ENTITY_ID,
    name: 'Sponsor',
    imageUrl: 'https://cdn.example/sponsor.png',
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
  };
}

function adEntity() {
  return {
    id: ENTITY_ID,
    title: 'Ad',
    imageUrl: 'https://cdn.example/ad.png',
    linkUrl: null,
    sortOrder: 0,
    isActive: true,
    startsAt: null,
    endsAt: null,
  };
}

describe('PlatformResolver login page images', () => {
  let platformService: jest.Mocked<Pick<PlatformService, 'getSettings'>>;
  let loginPageImagesSettingsService: jest.Mocked<
    Pick<
      LoginPageImagesSettingsService,
      'get' | 'updateConfigured' | 'clearDesktop' | 'clearMobile'
    >
  >;
  let bankTransferSettingsService: jest.Mocked<
    Pick<BankTransferSettingsService, 'get' | 'getConfigured' | 'update'>
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
    bankTransferSettingsService = {
      get: jest.fn(),
      getConfigured: jest.fn(),
      update: jest.fn(),
    };
    resolver = new PlatformResolver(
      platformService as unknown as PlatformService,
      loginPageImagesSettingsService as unknown as LoginPageImagesSettingsService,
      bankTransferSettingsService as unknown as BankTransferSettingsService,
      { log: jest.fn() } as unknown as AuditLogsService,
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

      const result = await resolver.updateLoginPageImages(ADMIN_ID, ADMIN_EMAIL, input);

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

      const result = await resolver.clearLoginPageDesktopImage(ADMIN_ID, ADMIN_EMAIL);

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

      const result = await resolver.clearLoginPageMobileImage(ADMIN_ID, ADMIN_EMAIL);

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

describe('PlatformResolver audit logging (AC-B-003 / D011)', () => {
  let platformService: {
    createBanner: jest.Mock;
    updateBanner: jest.Mock;
    deleteBanner: jest.Mock;
    reorderBanners: jest.Mock;
    createSponsor: jest.Mock;
    updateSponsor: jest.Mock;
    deleteSponsor: jest.Mock;
    reorderSponsors: jest.Mock;
    createAd: jest.Mock;
    updateAd: jest.Mock;
    deleteAd: jest.Mock;
  };
  let loginPageImagesSettingsService: {
    updateConfigured: jest.Mock;
    clearDesktop: jest.Mock;
    clearMobile: jest.Mock;
  };
  let bankTransferSettingsService: { update: jest.Mock };
  let auditLogsService: { log: jest.Mock };
  let resolver: PlatformResolver;

  beforeEach(() => {
    platformService = {
      createBanner: jest.fn(),
      updateBanner: jest.fn(),
      deleteBanner: jest.fn(),
      reorderBanners: jest.fn(),
      createSponsor: jest.fn(),
      updateSponsor: jest.fn(),
      deleteSponsor: jest.fn(),
      reorderSponsors: jest.fn(),
      createAd: jest.fn(),
      updateAd: jest.fn(),
      deleteAd: jest.fn(),
    };
    loginPageImagesSettingsService = {
      updateConfigured: jest.fn(),
      clearDesktop: jest.fn(),
      clearMobile: jest.fn(),
    };
    bankTransferSettingsService = { update: jest.fn() };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = new PlatformResolver(
      platformService as unknown as PlatformService,
      loginPageImagesSettingsService as unknown as LoginPageImagesSettingsService,
      bankTransferSettingsService as unknown as BankTransferSettingsService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('does not define SETTINGS_AD_REORDERED or settings.ad.reordered', () => {
    expect(AuditAction).not.toHaveProperty('SETTINGS_AD_REORDERED');
    expect(Object.values(AuditAction)).not.toContain('settings.ad.reordered');
  });

  it('logs banner CUD with entity uuid', async () => {
    platformService.createBanner.mockResolvedValue(bannerEntity());
    platformService.updateBanner.mockResolvedValue(bannerEntity());
    platformService.deleteBanner.mockResolvedValue(true);

    await resolver.createPlatformBanner(
      ADMIN_ID,
      ADMIN_EMAIL,
      { title: 'Hero', imageUrl: 'https://cdn.example/banner.png' },
      graphqlContext,
    );
    await resolver.updatePlatformBanner(
      ADMIN_ID,
      ADMIN_EMAIL,
      { id: ENTITY_ID, title: 'Hero 2' },
      graphqlContext,
    );
    await resolver.deletePlatformBanner(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(3);
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AuditAction.SETTINGS_BANNER_CREATED,
        resourceType: AuditResourceType.SETTINGS,
        resourceId: ENTITY_ID,
        actorType: AuditActorType.ADMIN,
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AuditAction.SETTINGS_BANNER_UPDATED,
        resourceId: ENTITY_ID,
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: AuditAction.SETTINGS_BANNER_DELETED,
        resourceId: ENTITY_ID,
      }),
    );
  });

  it('logs banner reorder with resourceId null and ids metadata', async () => {
    const ids = [ENTITY_ID, 'ffffffff-ffff-4fff-8fff-ffffffffffff'];
    platformService.reorderBanners.mockResolvedValue([bannerEntity()]);

    await resolver.reorderPlatformBanners(ADMIN_ID, ADMIN_EMAIL, ids, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SETTINGS_BANNER_REORDERED,
        resourceType: AuditResourceType.SETTINGS,
        resourceId: null,
        metadata: { ids },
      }),
    );
  });

  it('logs sponsor CUD and reorder', async () => {
    platformService.createSponsor.mockResolvedValue(sponsorEntity());
    platformService.updateSponsor.mockResolvedValue(sponsorEntity());
    platformService.deleteSponsor.mockResolvedValue(true);
    platformService.reorderSponsors.mockResolvedValue([sponsorEntity()]);

    await resolver.createPlatformSponsor(
      ADMIN_ID,
      ADMIN_EMAIL,
      { name: 'Sponsor', imageUrl: 'https://cdn.example/sponsor.png' },
      graphqlContext,
    );
    await resolver.updatePlatformSponsor(
      ADMIN_ID,
      ADMIN_EMAIL,
      { id: ENTITY_ID, name: 'Sponsor 2' },
      graphqlContext,
    );
    await resolver.deletePlatformSponsor(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);
    await resolver.reorderPlatformSponsors(ADMIN_ID, ADMIN_EMAIL, [ENTITY_ID], graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(4);
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AuditAction.SETTINGS_SPONSOR_CREATED,
        resourceId: ENTITY_ID,
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: AuditAction.SETTINGS_SPONSOR_UPDATED }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AuditAction.SETTINGS_SPONSOR_DELETED }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        action: AuditAction.SETTINGS_SPONSOR_REORDERED,
        resourceId: null,
        metadata: { ids: [ENTITY_ID] },
      }),
    );
  });

  it('logs ad CUD only (no reorder writer)', async () => {
    platformService.createAd.mockResolvedValue(adEntity());
    platformService.updateAd.mockResolvedValue(adEntity());
    platformService.deleteAd.mockResolvedValue(true);

    await resolver.createPlatformAd(
      ADMIN_ID,
      ADMIN_EMAIL,
      { title: 'Ad', imageUrl: 'https://cdn.example/ad.png' },
      graphqlContext,
    );
    await resolver.updatePlatformAd(
      ADMIN_ID,
      ADMIN_EMAIL,
      { id: ENTITY_ID, title: 'Ad 2' },
      graphqlContext,
    );
    await resolver.deletePlatformAd(ADMIN_ID, ADMIN_EMAIL, ENTITY_ID, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(3);
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: AuditAction.SETTINGS_AD_CREATED }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: AuditAction.SETTINGS_AD_UPDATED }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ action: AuditAction.SETTINGS_AD_DELETED }),
    );
    expect(auditLogsService.log).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'settings.ad.reordered' }),
    );
    expect(resolver).not.toHaveProperty('reorderPlatformAds');
  });

  it('logs login-page mutations with resourceId null and settingsKey platform.login_page_images', async () => {
    const images = {
      desktopImageUrl: 'https://cdn.example/login-images/desktop.png',
      mobileImageUrl: null,
      altText: null,
    };
    loginPageImagesSettingsService.updateConfigured.mockResolvedValue(images);
    loginPageImagesSettingsService.clearDesktop.mockResolvedValue(images);
    loginPageImagesSettingsService.clearMobile.mockResolvedValue(images);

    await resolver.updateLoginPageImages(
      ADMIN_ID,
      ADMIN_EMAIL,
      { desktopImageUrl: images.desktopImageUrl },
      graphqlContext,
    );
    await resolver.clearLoginPageDesktopImage(ADMIN_ID, ADMIN_EMAIL, graphqlContext);
    await resolver.clearLoginPageMobileImage(ADMIN_ID, ADMIN_EMAIL, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(3);
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_UPDATED,
        resourceType: AuditResourceType.SETTINGS,
        resourceId: null,
        metadata: { settingsKey: 'platform.login_page_images' },
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_CLEARED_DESKTOP,
        resourceId: null,
        metadata: { settingsKey: 'platform.login_page_images' },
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: AuditAction.SETTINGS_LOGIN_PAGE_IMAGES_CLEARED_MOBILE,
        resourceId: null,
        metadata: { settingsKey: 'platform.login_page_images' },
      }),
    );
  });

  it('logs bank-transfer update with resourceId null and settingsKey payment.bank_transfer', async () => {
    bankTransferSettingsService.update.mockResolvedValue({
      bankName: 'Kasikorn',
      accountName: 'SOPET',
      accountNumber: '123',
    });

    await resolver.updateBankTransferDetails(
      ADMIN_ID,
      ADMIN_EMAIL,
      { bankName: 'Kasikorn' } as never,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SETTINGS_BANK_TRANSFER_UPDATED,
        resourceType: AuditResourceType.SETTINGS,
        resourceId: null,
        metadata: { settingsKey: 'payment.bank_transfer' },
        requestId: 'req-platform-1',
      }),
    );
  });
});
