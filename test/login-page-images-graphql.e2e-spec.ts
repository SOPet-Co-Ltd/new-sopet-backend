// Login Page Images — GraphQL HTTP + auth boundary (Phase 3 Task 3.3)
// Design Doc: login-page-images-backend-design.md
// Distinct from test/login-page-images.int.test.ts (mocked service-only lane).
//
// @lane: integration
// Harness: Nest TestingModule + real GraphQLModule (ApolloDriver) + supertest POST /graphql
// @real-dependency: GraphQLModule, PlatformResolver, LoginPageImagesSettingsService, RolesGuard
// @mock-boundary: Setting repository, RedisService, StorageService, PlatformService
// Auth: override JwtAuthGuard (header-based, respects @Public) + real RolesGuard
//
// Covers (priority ACs over HTTP):
//   AC-003–005 public loginPageImages payloads (empty null triple + configured desktop/null mobile)
//   AC-006 admin updateLoginPageImages mutation + subsequent public read roundtrip
//   AC-007 anon Unauthorized + vendor Forbidden; settingStore/cacheStore not written on denial
//
// Run target:
//   yarn jest --config ./test/jest-e2e.json --testPathPatterns=login-page-images-graphql --no-coverage

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext, GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { Setting } from '../src/database/entities/setting.entity';
import { UserRole } from '../src/database/entities/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { LoginPageImagesSettingsService } from '../src/modules/platform/login-page-images-settings.service';
import { PlatformResolver } from '../src/modules/platform/platform.resolver';
import { PlatformService } from '../src/modules/platform/platform.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { StorageService } from '../src/modules/storage/storage.service';

const SETTINGS_KEY = 'platform.login_page_images';
const CACHE_KEY = 'platform:login_page_images';

const DESKTOP_URL =
  'https://cdn.example.com/login-images/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp';
const MOBILE_URL = 'https://cdn.example.com/login-images/b2c3d4e5-f6a7-8901-bcde-f12345678901.webp';

const LOGIN_PAGE_IMAGES_QUERY = `
  query LoginPageImages {
    loginPageImages {
      desktopImageUrl
      mobileImageUrl
      altText
    }
  }
`;

const UPDATE_LOGIN_PAGE_IMAGES_MUTATION = `
  mutation UpdateLoginPageImages($input: UpdateLoginPageImagesInput!) {
    updateLoginPageImages(input: $input) {
      desktopImageUrl
      mobileImageUrl
      altText
    }
  }
`;

const CLEAR_LOGIN_PAGE_DESKTOP_MUTATION = `
  mutation ClearLoginPageDesktopImage {
    clearLoginPageDesktopImage {
      desktopImageUrl
      mobileImageUrl
      altText
    }
  }
`;

interface LoginPageImagesPayload {
  desktopImageUrl: string | null;
  mobileImageUrl: string | null;
  altText: string | null;
}

interface GraphQLBody {
  data?: {
    loginPageImages?: LoginPageImagesPayload;
    updateLoginPageImages?: LoginPageImagesPayload;
    clearLoginPageDesktopImage?: LoginPageImagesPayload;
  } | null;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

function createLoginImagesAuthGuards(): { jwtGuard: CanActivate; rolesGuard: RolesGuard } {
  const reflector = new Reflector();

  const jwtGuard: CanActivate = {
    canActivate(context: ExecutionContext) {
      const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      const gqlContext = GqlExecutionContext.create(context).getContext<{
        req: {
          headers: Record<string, string | undefined>;
          user?: { id: string; role: string };
        };
      }>();
      const req = gqlContext.req;
      const role = req.headers['x-test-role'];
      const userId = req.headers['x-test-user-id'];

      if (role && userId) {
        req.user = { id: userId, role };
        return true;
      }

      if (isPublic) {
        return true;
      }

      throw new UnauthorizedException('Invalid or expired token');
    },
  };

  return { jwtGuard, rolesGuard: new RolesGuard(reflector) };
}

describe('Login page images GraphQL HTTP (e2e)', () => {
  let app: INestApplication<App>;
  let settingStore: Map<string, Setting>;
  let cacheStore: Map<string, string>;

  beforeEach(async () => {
    settingStore = new Map();
    cacheStore = new Map();

    const settingsRepository = {
      findOne: jest.fn(({ where: { key } }: { where: { key: string } }) =>
        Promise.resolve(settingStore.get(key) ?? null),
      ),
      create: jest.fn((data: Partial<Setting>) => ({ ...data }) as Setting),
      save: jest.fn((row: Setting) => {
        settingStore.set(row.key, { ...row });
        return Promise.resolve(row);
      }),
    };

    const redisService = {
      get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        cacheStore.set(key, value);
        return Promise.resolve(undefined);
      }),
    };

    const storageService = {
      assertFolderImageUrl: jest.fn(),
    };

    const { jwtGuard, rolesGuard } = createLoginImagesAuthGuards();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        }),
      ],
      providers: [
        PlatformResolver,
        LoginPageImagesSettingsService,
        { provide: PlatformService, useValue: { getSettings: jest.fn() } },
        { provide: getRepositoryToken(Setting), useValue: settingsRepository },
        { provide: RedisService, useValue: redisService },
        { provide: StorageService, useValue: storageService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtGuard)
      .overrideGuard(RolesGuard)
      .useValue(rolesGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  function postGraphql(
    query: string,
    variables?: Record<string, unknown>,
    headers?: Record<string, string>,
  ) {
    const req = request(app.getHttpServer()).post('/graphql');
    if (headers) {
      req.set(headers);
    }
    return req.send({ query, variables });
  }

  describe('public loginPageImages query (AC-003–004 / AC-005)', () => {
    // AC: "When configuration is missing or fully cleared, then public read succeeds with
    // desktopImageUrl, mobileImageUrl, and altText all null — no error" (AC-005)
    // Behavior: POST /graphql loginPageImages without Authorization → GraphQLModule +
    // PlatformResolver + LoginPageImagesSettingsService get() → HTTP 200 JSON null triple
    // @category: core-functionality
    // @lane: integration
    // @dependency: real GraphQLModule/supertest + PlatformResolver +
    // LoginPageImagesSettingsService; mocked Setting/Redis/Storage/PlatformService
    // @complexity: medium
    // ROI: 81 (BV:9 × Freq:8 + Legal:0 + Defect:9)
    it('returns empty null triple without Authorization when unconfigured', async () => {
      const res = await postGraphql(LOGIN_PAGE_IMAGES_QUERY).expect(200);
      const body = res.body as GraphQLBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.loginPageImages).toEqual({
        desktopImageUrl: null,
        mobileImageUrl: null,
        altText: null,
      });
    });

    // AC: "When a public GraphQL read runs without admin auth and desktop is configured,
    // then the response includes desktopImageUrl" (AC-003); "If mobile is unset, then public
    // read returns mobileImageUrl null while desktop may still be set" (AC-004)
    // Behavior: Seed Setting row (desktop URL, mobile null) → POST /graphql public
    // loginPageImages → HTTP payload desktop URL + mobileImageUrl null + altText
    // @category: core-functionality
    // @lane: integration
    // @dependency: real GraphQLModule/supertest + PlatformResolver +
    // LoginPageImagesSettingsService; mocked Setting/Redis/Storage/PlatformService
    // @complexity: medium
    // ROI: 99 (BV:10 × Freq:9 + Legal:0 + Defect:9)
    it('returns configured desktop URL and null mobile over public HTTP (AC-003–004)', async () => {
      settingStore.set(SETTINGS_KEY, {
        key: SETTINGS_KEY,
        value: {
          desktopImageUrl: DESKTOP_URL,
          mobileImageUrl: null,
          altText: 'Hero',
        },
        description: 'Login page desktop/mobile images and alt text',
      } as Setting);

      const res = await postGraphql(LOGIN_PAGE_IMAGES_QUERY).expect(200);
      const body = res.body as GraphQLBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.loginPageImages).toEqual({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: null,
        altText: 'Hero',
      });
    });
  });

  describe('admin mutation over GraphQL HTTP (AC-006)', () => {
    // AC: "When an authenticated platform admin writes valid login images, then the write
    // succeeds" (AC-006)
    // Behavior: Admin-header updateLoginPageImages → mutation payload matches input →
    // subsequent public loginPageImages returns same DTO; Setting + Redis written
    // @category: core-functionality
    // @lane: integration
    // @dependency: real GraphQLModule/supertest + PlatformResolver +
    // LoginPageImagesSettingsService + RolesGuard; mocked Setting/Redis/Storage/PlatformService
    // @complexity: high
    // ROI: 89 (BV:10 × Freq:8 + Legal:0 + Defect:9)
    it('updateLoginPageImages as admin persists and is visible on subsequent public query', async () => {
      const adminHeaders = {
        'x-test-user-id': 'admin-1',
        'x-test-role': UserRole.ADMIN,
      };

      const mutateRes = await postGraphql(
        UPDATE_LOGIN_PAGE_IMAGES_MUTATION,
        {
          input: {
            desktopImageUrl: DESKTOP_URL,
            mobileImageUrl: MOBILE_URL,
            altText: 'Welcome',
          },
        },
        adminHeaders,
      ).expect(200);

      const mutateBody = mutateRes.body as GraphQLBody;
      expect(mutateBody.errors).toBeUndefined();
      expect(mutateBody.data?.updateLoginPageImages).toEqual({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: MOBILE_URL,
        altText: 'Welcome',
      });

      const queryRes = await postGraphql(LOGIN_PAGE_IMAGES_QUERY).expect(200);
      const queryBody = queryRes.body as GraphQLBody;
      expect(queryBody.errors).toBeUndefined();
      expect(queryBody.data?.loginPageImages).toEqual({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: MOBILE_URL,
        altText: 'Welcome',
      });

      expect(settingStore.get(SETTINGS_KEY)?.value).toEqual({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: MOBILE_URL,
        altText: 'Welcome',
      });
      expect(cacheStore.get(CACHE_KEY)).toBeDefined();
      expect(JSON.parse(cacheStore.get(CACHE_KEY)!)).toEqual({
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: MOBILE_URL,
        altText: 'Welcome',
      });
    });
  });

  describe('non-admin write rejection (AC-007)', () => {
    // AC: "If a vendor or unauthenticated caller attempts a write/clear mutation, then the
    // operation is rejected (authorization failure)" (AC-007) — unauthenticated path
    // Behavior: POST updateLoginPageImages without auth headers → Unauthorized GraphQL
    // errors; settingStore and cacheStore remain unwritten
    // @category: edge-case
    // @lane: integration
    // @dependency: real GraphQLModule/supertest + PlatformResolver + JwtAuthGuard override
    // (respects non-@Public); mocked Setting/Redis/Storage/PlatformService
    // @complexity: medium
    // ROI: 73 (BV:9 × Freq:7 + Legal:0 + Defect:10)
    it('rejects unauthenticated updateLoginPageImages', async () => {
      expect(settingStore.size).toBe(0);
      expect(cacheStore.size).toBe(0);

      const res = await postGraphql(UPDATE_LOGIN_PAGE_IMAGES_MUTATION, {
        input: { desktopImageUrl: DESKTOP_URL },
      }).expect(200);

      const body = res.body as GraphQLBody;
      expect(body.data?.updateLoginPageImages ?? null).toBeNull();
      expect(body.errors?.length).toBeGreaterThan(0);
      expect(body.errors![0].message).toMatch(/Invalid or expired token|Unauthorized/i);

      expect(settingStore.size).toBe(0);
      expect(settingStore.has(SETTINGS_KEY)).toBe(false);
      expect(cacheStore.size).toBe(0);
      expect(cacheStore.has(CACHE_KEY)).toBe(false);
    });

    // AC: "If a vendor or unauthenticated caller attempts a write/clear mutation, then the
    // operation is rejected (authorization failure)" (AC-007) — vendor Forbidden path
    // Behavior: Seed configured Setting+cache → vendor clearLoginPageDesktopImage →
    // Forbidden GraphQL errors; settingStore and cacheStore unchanged (not written)
    // @category: edge-case
    // @lane: integration
    // @dependency: real GraphQLModule/supertest + PlatformResolver + RolesGuard;
    // mocked Setting/Redis/Storage/PlatformService
    // @complexity: medium
    // ROI: 73 (BV:9 × Freq:7 + Legal:0 + Defect:10)
    it('rejects vendor clearLoginPageDesktopImage', async () => {
      const configuredValue = {
        desktopImageUrl: DESKTOP_URL,
        mobileImageUrl: MOBILE_URL,
        altText: 'Hero',
      };
      settingStore.set(SETTINGS_KEY, {
        key: SETTINGS_KEY,
        value: configuredValue,
        description: 'Login page desktop/mobile images and alt text',
      } as Setting);
      cacheStore.set(CACHE_KEY, JSON.stringify(configuredValue));

      const settingBefore = settingStore.get(SETTINGS_KEY);
      const cacheBefore = cacheStore.get(CACHE_KEY);

      const res = await postGraphql(CLEAR_LOGIN_PAGE_DESKTOP_MUTATION, undefined, {
        'x-test-user-id': 'vendor-1',
        'x-test-role': UserRole.VENDOR,
      }).expect(200);

      const body = res.body as GraphQLBody;
      expect(body.data?.clearLoginPageDesktopImage ?? null).toBeNull();
      expect(body.errors?.length).toBeGreaterThan(0);
      expect(body.errors![0].message).toMatch(/Forbidden|forbidden/i);

      expect(settingStore.get(SETTINGS_KEY)).toEqual(settingBefore);
      expect(settingStore.get(SETTINGS_KEY)?.value).toEqual(configuredValue);
      expect(cacheStore.get(CACHE_KEY)).toBe(cacheBefore);
    });
  });
});
