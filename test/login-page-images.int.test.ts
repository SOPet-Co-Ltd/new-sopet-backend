// Login Page Images [integration] Test
// Design Doc: login-page-images-backend-design.md
// Admin Design Doc: login-page-images-admin-design.md (consumer contracts)
// UI Spec: login-page-images-ui-spec.md | PRD: login-page-images-prd.md
// Generated: 2026-07-22 | Budget Used: integration 3/3, fixture-e2e 3/3 (sopet-admin), service-e2e 0/2
//
// Implement alongside: src/modules/platform/login-page-images-settings.service.ts
// Unit companion (out of this lane): login-page-images-settings.service.spec.ts
//   — push-down: AC-008 desktop-required code, AC-007 RolesGuard metadata, alt>255 input
// Run target (when executable):
//   yarn jest --config ./test/jest-e2e.json --testRegex='login-page-images.int.test.ts$' --no-coverage
//
// Covers (priority ACs):
//   Empty public-read (no merge-defaults) + configured save → get
//   Clear desktop → full empty + Redis overwrite
//   Clear mobile → mobile null, desktop+alt retained
//
// Harness: Nest TestingModule + LoginPageImagesSettingsService; mocked TypeORM Setting repo;
// mocked RedisService; mocked StorageService.assertFolderImageUrl
//
// Test Boundaries compliance (Backend Design Doc § Test Boundaries):
// Mock: Repository<Setting> — upsert/empty without DB
// Mock: RedisService — assert get/set/TTL overwrite-on-write
// Mock: StorageService.assertFolderImageUrl — called with folder 'login-images'
// Mock: Real S3/MinIO — out of scope
// @real-dependency: LoginPageImagesSettingsService get/updateConfigured/clearDesktop/clearMobile
//
// Dedup / push-down notes:
//   No existing login-page-images tests (grep clean).
//   AC-007 authz → unit/resolver metadata or existing RolesGuard suite (not this file).
//   AC-008 / alt length → unit service.spec (validation-only).
//   service-integration-e2e omitted: Design Doc accepts mocked repo+Redis for MVP;
//   empty/cache overwrite proven here via mock set(empty) assertions.
//
// ---------------------------------------------------------------------------
// Integration test 1 of 3 — Empty get + configured save + public get (no defaults)
// ---------------------------------------------------------------------------
//
// AC-001: "When an admin saves a valid desktop image (mobile optional) with no prior row,
// then a Setting row with key platform.login_page_images exists and subsequent public reads
// return the saved URLs"
// AC-003: "When a public GraphQL read runs without admin auth and desktop is configured,
// then the response includes desktopImageUrl"
// AC-004: "If mobile is unset, then public read returns mobileImageUrl null while desktop
// may still be set"
// AC-005: "When configuration is missing or fully cleared, then public read succeeds with
// desktopImageUrl, mobileImageUrl, and altText all null — no error"
// AC-009: "When a save has desktop only, then it succeeds and mobile remains null"
// ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
// Behavior: get() with no row → {null,null,null}; updateConfigured(desktop only) → Setting
// upsert key platform.login_page_images + Redis set TTL 60s; get() returns desktop URL,
// mobile null, alt null; never invents placeholder URLs (anti-SearchSettings merge)
// @category: core-functionality
// @lane: integration
// @dependency: LoginPageImagesSettingsService, Repository<Setting>, RedisService,
// StorageService.assertFolderImageUrl
// @complexity: high
// Primary failure mode: get() merges default/placeholder image URLs on miss; or save does
// not upsert key platform.login_page_images; or desktop-only save stores fabricated mobile
// Proof obligation: (1) findOne miss → get returns exact null triple; (2) updateConfigured
// with non-empty desktopImageUrl, omitted mobile/alt → save called with key
// platform.login_page_images and value desktop set / mobile+alt null; Redis set called with
// matching DTO and TTL 60s; assertFolderImageUrl(desktop, 'login-images'); (3) subsequent
// get returns same URLs. Boundary: mobile unset stays null (AC-004). Mock repo/Redis/Storage
// only — no live DB.
// Verification points / expected results / pass criteria:
// - get() miss → { desktopImageUrl: null, mobileImageUrl: null, altText: null }
// - updateConfigured desktop-only → Setting.save with key platform.login_page_images
// - assertFolderImageUrl called with folder 'login-images' for desktop
// - Redis set called after write (TTL 60s / overwrite-on-write)
// - get() after save → desktop URL present; mobileImageUrl null; altText null
// - No mergeWithDefaults-style placeholder URLs on empty or configured paths
//
// ---------------------------------------------------------------------------
// Integration test 2 of 3 — Clear desktop → full empty + cache overwrite
// ---------------------------------------------------------------------------
//
// AC-013: "When an admin clears desktop, then desktop, mobile, and alt are all null and
// public read is fully empty — persist immediate"
// AC-005 (post-clear): public read succeeds with all nulls — no error
// AC-002 / AC-011 (setup): configured replace path yields stored URLs before clear
// ROI: 90 (BV:10 × Freq:8 + Legal:0 + Defect:10)
// Behavior: Configured state (desktop+mobile+alt) → clearDesktop() → upsert empty nulls +
// Redis set empty DTO; get() (cache path and DB path) returns null triple
// @category: core-functionality
// @lane: integration
// @dependency: LoginPageImagesSettingsService, Repository<Setting>, RedisService
// @complexity: high
// Primary failure mode: clear leaves mobile/alt; Redis retains stale configured DTO after
// clear (WYSIWYG fail); or get() after clear invents defaults
// Proof obligation: Seed configured value via updateConfigured (desktop+mobile+alt) →
// clearDesktop() → save upserts {null,null,null}; Redis set called with empty DTO (overwrite);
// get() with cache hit returning empty triple; get() with cache miss + empty row also null
// triple. Boundary: Unconfigured → clearDesktop idempotent empty. Mock only.
// Verification points / expected results / pass criteria:
// - After clearDesktop: persisted value all three fields null
// - Redis set invoked with empty DTO on clear (no stale configured cache)
// - get() returns { desktopImageUrl: null, mobileImageUrl: null, altText: null }
// - Idempotent clear when already empty still succeeds with empty DTO
//
// ---------------------------------------------------------------------------
// Integration test 3 of 3 — Clear mobile retains desktop + alt
// ---------------------------------------------------------------------------
//
// AC-012: "When an admin clears mobile, then public read returns mobile null and desktop
// unchanged — persist immediate"
// AC-010 (setup note): mobile update with retained desktopImageUrl (String!) succeeds before clear
// AC-019 (boundary): alt retained on mobile-only clear (Backend DD locked)
// ROI: 64 (BV:8 × Freq:7 + Legal:0 + Defect:8)
// Behavior: Configured desktop+mobile+alt → clearMobile() → mobile null; desktop+alt unchanged;
// Redis overwritten with partial-clear DTO
// @category: core-functionality
// @lane: integration
// @dependency: LoginPageImagesSettingsService, Repository<Setting>, RedisService
// @complexity: medium
// Primary failure mode: clearMobile also nulls desktop/alt; or does not persist/cache update;
// or requires updateConfigured null-patch instead of clearMobile
// Proof obligation: Seed configured desktop+mobile+alt → clearMobile() → save value has
// desktopImageUrl and altText unchanged, mobileImageUrl null; Redis set with that DTO;
// get() matches. Boundary: clearMobile when already empty/desktop-null → succeeds returning
// empty (idempotent per Data Contracts). Mock only.
// Verification points / expected results / pass criteria:
// - clearMobile → mobileImageUrl null; desktopImageUrl unchanged; altText unchanged
// - Redis set called with post-clear DTO
// - get() reflects mobile-null configured state
// - Idempotent when mobile already null

import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Setting } from '../src/database/entities/setting.entity';
import {
  LoginPageImagesSettingsService,
  type LoginPageImagesValue,
} from '../src/modules/platform/login-page-images-settings.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { StorageService } from '../src/modules/storage/storage.service';

const SETTINGS_KEY = 'platform.login_page_images';
const CACHE_KEY = 'platform:login_page_images';
const CACHE_TTL_SECONDS = 60;
const LOGIN_IMAGES_FOLDER = 'login-images';

const EMPTY_LOGIN_PAGE_IMAGES: LoginPageImagesValue = {
  desktopImageUrl: null,
  mobileImageUrl: null,
  altText: null,
};

const DESKTOP_URL =
  'https://cdn.example.com/login-images/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp';
const MOBILE_URL = 'https://cdn.example.com/login-images/b2c3d4e5-f6a7-8901-bcde-f12345678901.webp';
const ALT_TEXT = 'Welcome to SOPET';

describe('login-page-images integration', () => {
  let service: LoginPageImagesSettingsService;
  let settingStore: Map<string, Setting>;
  let cacheStore: Map<string, string>;
  let settingsRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let redisService: {
    get: jest.Mock;
    set: jest.Mock;
  };
  let storageService: {
    assertFolderImageUrl: jest.Mock;
  };

  async function compileService() {
    settingStore = new Map();
    cacheStore = new Map();

    settingsRepository = {
      findOne: jest.fn(({ where: { key } }: { where: { key: string } }) =>
        Promise.resolve(settingStore.get(key) ?? null),
      ),
      create: jest.fn((data: Partial<Setting>) => ({ ...data }) as Setting),
      save: jest.fn((row: Setting) => {
        settingStore.set(row.key, { ...row });
        return Promise.resolve(row);
      }),
    };

    redisService = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        cacheStore.set(key, value);
        return Promise.resolve(undefined);
      }),
    };

    storageService = {
      assertFolderImageUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoginPageImagesSettingsService,
        { provide: getRepositoryToken(Setting), useValue: settingsRepository },
        { provide: RedisService, useValue: redisService },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    return module.get(LoginPageImagesSettingsService);
  }

  beforeEach(async () => {
    service = await compileService();
  });

  // Integration test 1 — Empty get + configured save + public get (no defaults)
  // Primary failure mode: get() merges default/placeholder image URLs on miss; or save does
  // not upsert key platform.login_page_images; or desktop-only save stores fabricated mobile
  // Proof obligation: miss → null triple; desktop-only upsert key + Redis TTL 60; subsequent get
  it('get miss returns null triple then desktop-only save upserts key and returns configured get', async () => {
    const empty = await service.get();
    expect(empty).toEqual(EMPTY_LOGIN_PAGE_IMAGES);

    const saved = await service.updateConfigured({ desktopImageUrl: DESKTOP_URL });

    const expected: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: null,
    };
    expect(saved).toEqual(expected);
    expect(storageService.assertFolderImageUrl).toHaveBeenCalledWith(
      DESKTOP_URL,
      LOGIN_IMAGES_FOLDER,
    );
    expect(settingsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: expected,
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(expected),
      CACHE_TTL_SECONDS,
    );
    expect(JSON.stringify(saved)).not.toMatch(/placeholder|default/i);

    const afterSave = await service.get();
    expect(afterSave).toEqual(expected);
    expect(afterSave.mobileImageUrl).toBeNull();
    expect(afterSave.altText).toBeNull();
  });

  // Integration test 2 — Clear desktop → full empty + cache overwrite
  // Primary failure mode: clear leaves mobile/alt; Redis retains stale configured DTO after
  // clear; or get() after clear invents defaults
  // Proof obligation: configured → clearDesktop → null triple persisted + cached (hit + miss)
  it('clearDesktop empties all fields and overwrites Redis; get cache and DB paths empty', async () => {
    await service.updateConfigured({
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: ALT_TEXT,
    });
    redisService.set.mockClear();

    const cleared = await service.clearDesktop();
    expect(cleared).toEqual(EMPTY_LOGIN_PAGE_IMAGES);
    expect(settingsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: EMPTY_LOGIN_PAGE_IMAGES,
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(EMPTY_LOGIN_PAGE_IMAGES),
      CACHE_TTL_SECONDS,
    );

    // Cache-hit path: Redis holds empty DTO from overwrite
    const fromCache = await service.get();
    expect(fromCache).toEqual(EMPTY_LOGIN_PAGE_IMAGES);

    // Cache-miss + empty row path
    cacheStore.delete(CACHE_KEY);
    const fromDb = await service.get();
    expect(fromDb).toEqual(EMPTY_LOGIN_PAGE_IMAGES);

    // Idempotent clear when already empty
    const again = await service.clearDesktop();
    expect(again).toEqual(EMPTY_LOGIN_PAGE_IMAGES);
  });

  // Integration test 3 — Clear mobile retains desktop + alt
  // Primary failure mode: clearMobile also nulls desktop/alt; or does not persist/cache update;
  // or requires updateConfigured null-patch instead of clearMobile
  // Proof obligation: clearMobile → mobile null; desktop+alt unchanged; Redis overwritten
  it('clearMobile nulls mobile only and retains desktop + alt; Redis overwritten', async () => {
    await service.updateConfigured({
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: MOBILE_URL,
      altText: ALT_TEXT,
    });
    redisService.set.mockClear();

    const afterClear = await service.clearMobile();
    const expected: LoginPageImagesValue = {
      desktopImageUrl: DESKTOP_URL,
      mobileImageUrl: null,
      altText: ALT_TEXT,
    };
    expect(afterClear).toEqual(expected);
    expect(settingsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: SETTINGS_KEY,
        value: expected,
      }),
    );
    expect(redisService.set).toHaveBeenCalledWith(
      CACHE_KEY,
      JSON.stringify(expected),
      CACHE_TTL_SECONDS,
    );

    const fromGet = await service.get();
    expect(fromGet).toEqual(expected);

    // Idempotent when mobile already null
    const again = await service.clearMobile();
    expect(again).toEqual(expected);

    // Unconfigured → clearMobile still empty
    await service.clearDesktop();
    const emptyClear = await service.clearMobile();
    expect(emptyClear).toEqual(EMPTY_LOGIN_PAGE_IMAGES);
  });
});
