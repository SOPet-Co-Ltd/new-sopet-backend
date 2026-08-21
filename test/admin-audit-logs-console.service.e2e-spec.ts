// Admin Audit Logs Console [service-integration-e2e]
// Promoted from test/admin-audit-logs-console.service.e2e.test.ts
// Design Doc: admin-audit-logs-console-backend-design.md
// Frontend Design Doc: admin-audit-logs-console-frontend-design.md
// UI Spec: admin-audit-logs-console-ui-spec.md | PRD: admin-audit-logs-console-prd.md
// Generated: 2026-08-19 | Budget Used: integration 3/3, fixture-e2e 1/3 (sopet-admin), service-e2e 1/2 (this file)
//
// Run (requires local Postgres — `yarn docker:up`; soft-skips in CI without Docker):
//   yarn test:e2e --testPathPatterns=admin-audit-logs-console.service.e2e-spec
//
// Registered by test/jest-e2e.json testRegex: ".e2e-spec.ts$"
//
// Additional service-integration-e2e slot (ROI > 50): GraphQL adminAuditLogs requestId mapping and
// equality filter plus retention hard-delete must persist across a real DB write. Fixture/mock
// query builders cannot prove column name request_id, mapper field, RolesGuard, or DELETE … WHERE
// created_at < cutoff. Not a reserved slot — the user-facing console journey is fixture-e2e with
// a mocked hook and does not require live services.
//
// Test Boundaries compliance:
// @real-dependency: PostgreSQL (audit_logs including request_id)
// @real-dependency: AuditLogsResolver.adminAuditLogs + AuditLogsService.findAllForAdmin / log / purgeExpired
// Mock: BullMQ/Redis scheduler registration (invoke processor/purgeExpired directly against real DB)
// Mock: none on GraphQL hot path — prefer seeded audit_logs rows over mocked repositories
//
// User/API journeys covered:
//   #1 Admin lists logs and filters by requestId (column equality)
//   #2 Non-admin cannot call adminAuditLogs
//   #3 Retention deletes only rows older than 60 days
//
// ---------------------------------------------------------------------------
// service-integration-e2e test 1 of 1 — adminAuditLogs GraphQL + retention hard-delete
// ---------------------------------------------------------------------------
//
// AC-B-012: "GraphQL AdminAuditLogType shall expose nullable requestId: String in addition to
// existing fields."
// AC-B-013: "When AdminAuditLogFilterInput.requestId is provided, findAllForAdmin shall add
// log.requestId = :requestId (equality). When omitted, the system shall not filter by request id."
// AC-B-015: "When a request id is available, log shall persist the same value on column request_id
// and metadata.requestId."
// AC-B-016: "adminAuditLogs shall keep default limit=20 and server cap 100."
// AC-B-022: "Access to adminAuditLogs shall remain @Roles('admin')."
// AC-B-018: "… hard-delete audit_logs where created_at < now() - retentionDays (default 60) in
// batches of 1000, looping until a batch deletes 0 rows."
// AC-B-020: "Retention delete shall target only rows older than 60 days … and leave newer rows
// intact."
// ROI: 120 (BV:10 × Freq:10 + Legal:true×10 + Defect:10)
// Behavior: Seed three audit_logs rows in real Postgres — (A) created 61 days ago, (B) created
// 1 day ago with requestId 'corr-1', (C) created 1 day ago with requestId 'corr-2'. Admin JWT
// adminAuditLogs(filter: { requestId: "corr-1" }) returns B only with GraphQL requestId 'corr-1'
// matching metadata.requestId. Unauthenticated and vendor JWT receive forbidden/unauthorized and
// no items. Default limit in response pagination is 20. Direct purgeExpired(now-60d, 1000) then
// loop until 0 → SQL count: A gone, B and C remain; a subsequent adminAuditLogs without filter
// still returns B and C and never A.
// @category: service-integration-e2e
// @lane: service-integration-e2e
// @dependency: full-system (local Nest + real Postgres), admin JWT, vendor JWT, AuditLogsService.purgeExpired
// @complexity: high
// Primary failure mode: GraphQL omits requestId or filters via JSON text so equality misses the
// column; vendor/unauth can list platform audit rows; purge deletes the 1-day-old correlated row
// (cutoff too new) or leaves the 61-day-old row (DELETE never hits Postgres).
// Proof obligation: Insert rows with known ids/timestamps/requestId (bypass GraphQL writers).
// POST GraphQL adminAuditLogs as admin with filter.requestId 'corr-1'; assert HTTP 200, items
// length 1, items[0].requestId === 'corr-1', parsed metadata.requestId === 'corr-1', pagination.limit
// 20. Repeat without JWT and with vendor JWT → error extensions code/role deny and data null/empty.
// Call purgeExpired with cutoff = frozenNow - 60 days (or production helper) until 0; SELECT
// remaining ids = {B, C}. Re-query adminAuditLogs without requestId filter as admin includes B and
// C, not A. Boundary path: requestId equality must not return corr-2; retention must not delete
// corr-1. No repository mocks.
// Verification points / expected results / pass criteria:
//   - Admin query with requestId filter returns exactly the matching new row
//   - GraphQL items[].requestId is the column value (nullable field present even when testing a set value)
//   - pagination.limit is 20 for default args
//   - Vendor and unauthenticated callers cannot read items
//   - After purge, 61-day-old row absent from DB and from a subsequent admin list
//   - After purge, 1-day-old rows including the correlated requestId row still present
//   - Fail if filter returns both requestIds, requestId field missing, or new rows deleted

import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../src/common/interfaces';
import { AuditActorType, AuditLog } from '../src/database/entities/audit-log.entity';
import { Customer } from '../src/database/entities/customer.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { AuditLogsResolver } from '../src/modules/audit-logs/audit-logs.resolver';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { AUDIT_LOG_RETENTION_BATCH_SIZE } from '../src/modules/audit-logs/audit-log-retention.constants';
import { isPostgresAvailable } from './helpers';
import { createTypeOrmTestOptions } from './helpers/typeorm-test.config';

const E2E_JWT_SECRET = 'sopet-e2e-admin-audit-logs-jwt';
const FROZEN_NOW = new Date('2026-08-19T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_A_CREATED_AT = new Date(FROZEN_NOW.getTime() - 61 * DAY_MS);
const ROW_B_CREATED_AT = new Date(FROZEN_NOW.getTime() - 1 * DAY_MS);
const ROW_C_CREATED_AT = new Date(FROZEN_NOW.getTime() - 1 * DAY_MS);
const PURGE_CUTOFF = new Date(FROZEN_NOW.getTime() - 60 * DAY_MS);
const E2E_ACTION = 'e2e.admin_audit_logs_console';
const E2E_RESOURCE_TYPE = 'e2e_audit_console';
const REQUEST_ID_B = 'corr-1';
const REQUEST_ID_C = 'corr-2';

const ADMIN_AUDIT_LOGS_QUERY = `
  query AdminAuditLogs($filter: AdminAuditLogFilterInput) {
    adminAuditLogs(filter: $filter) {
      items {
        id
        requestId
        metadata
        action
      }
      pagination {
        page
        limit
        total
      }
    }
  }
`;

type AdminAuditLogGraphql = {
  id: string;
  requestId: string | null;
  metadata: string | null;
  action: string;
};

type AdminAuditLogsData = {
  adminAuditLogs: {
    items: AdminAuditLogGraphql[];
    pagination: { page: number; limit: number; total: number };
  } | null;
};

type GraphqlBody = {
  data?: AdminAuditLogsData | null;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
};

function signAccessToken(input: {
  userId: string;
  email: string;
  role: 'admin' | 'vendor';
  storeId?: string;
}): string {
  const jwtService = new JwtService({
    secret: E2E_JWT_SECRET,
    signOptions: { expiresIn: '1h' },
  });
  const payload: JwtPayload = {
    sub: input.userId,
    email: input.email,
    role: input.role,
    type: 'access',
    ver: 0,
    ...(input.storeId ? { storeId: input.storeId } : {}),
  };
  return jwtService.sign(payload);
}

describe('admin audit logs console (service-integration-e2e)', () => {
  let postgresAvailable = false;
  let app: INestApplication | undefined;
  let moduleFixture: TestingModule | undefined;
  let dataSource: DataSource;
  let auditLogsService: AuditLogsService;
  let adminUserId = '';
  let vendorUserId = '';
  let rowAId = '';
  let rowBId = '';
  let rowCId = '';
  let actorLabel = '';
  let adminToken = '';
  let vendorToken = '';
  let orderAuditCountBefore = 0;
  let adminLogCountBefore = 0;

  beforeAll(async () => {
    postgresAvailable = await isPostgresAvailable();
    // Skip bootstrap when Postgres is missing — CI e2e has no Docker (see .github/workflows/ci.yml).
    // Run locally with `yarn docker:up` to execute this service-e2e journey.
    if (!postgresAvailable) {
      return;
    }

    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = E2E_JWT_SECRET;
    }

    moduleFixture = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        TypeOrmModule.forRoot(createTypeOrmTestOptions()),
        TypeOrmModule.forFeature([AuditLog, User, Customer]),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          context: ({ req, res }: { req: unknown; res: unknown }) => ({ req, res }),
        }),
      ],
      providers: [
        AuditLogsResolver,
        AuditLogsService,
        JwtStrategy,
        JwtAuthGuard,
        RolesGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'jwt.secret' ? E2E_JWT_SECRET : undefined),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    auditLogsService = moduleFixture.get(AuditLogsService);

    actorLabel = `e2e-audit-console-${Date.now()}`;
    const userRepo = dataSource.getRepository(User);
    const adminUser = await userRepo.save(
      userRepo.create({
        email: `admin-audit-e2e-${actorLabel}@sopet.test`,
        passwordHash: 'e2e-unused-hash',
        fullName: 'E2E Admin Audit',
        role: UserRole.ADMIN,
        emailVerified: true,
        isActive: true,
        tokenVersion: 0,
      }),
    );
    const vendorUser = await userRepo.save(
      userRepo.create({
        email: `vendor-audit-e2e-${actorLabel}@sopet.test`,
        passwordHash: 'e2e-unused-hash',
        fullName: 'E2E Vendor Audit',
        role: UserRole.VENDOR,
        emailVerified: true,
        isActive: true,
        tokenVersion: 0,
      }),
    );
    adminUserId = adminUser.id;
    vendorUserId = vendorUser.id;
    adminToken = signAccessToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'admin',
    });
    vendorToken = signAccessToken({
      userId: vendorUser.id,
      email: vendorUser.email,
      role: 'vendor',
      storeId: randomUUID(),
    });

    orderAuditCountBefore = await countTableRows('order_audit_logs');
    adminLogCountBefore = await countTableRows('admin_logs');

    rowAId = await insertAuditRow({
      actorLabel,
      requestId: null,
      metadata: { seed: 'A' },
      createdAt: ROW_A_CREATED_AT,
    });
    rowBId = await insertAuditRow({
      actorLabel,
      requestId: REQUEST_ID_B,
      metadata: { seed: 'B', requestId: REQUEST_ID_B },
      createdAt: ROW_B_CREATED_AT,
    });
    rowCId = await insertAuditRow({
      actorLabel,
      requestId: REQUEST_ID_C,
      metadata: { seed: 'C', requestId: REQUEST_ID_C },
      createdAt: ROW_C_CREATED_AT,
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DELETE FROM audit_logs WHERE actor_label = $1`, [actorLabel]);
      if (adminUserId || vendorUserId) {
        await dataSource.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          [adminUserId, vendorUserId].filter(Boolean),
        ]);
      }
    }
    if (app) {
      await app.close();
    }
  });

  function skipWithoutPostgres(): boolean {
    return !postgresAvailable;
  }

  async function countTableRows(table: string): Promise<number> {
    const rows = await dataSource.query<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM ${table}`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function insertAuditRow(input: {
    actorLabel: string;
    requestId: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }): Promise<string> {
    const repo = dataSource.getRepository(AuditLog);
    const saved = await repo.save(
      repo.create({
        actorType: AuditActorType.ADMIN,
        actorId: null,
        actorLabel: input.actorLabel,
        action: E2E_ACTION,
        resourceType: E2E_RESOURCE_TYPE,
        resourceId: null,
        metadata: input.metadata,
        ipAddress: null,
        requestId: input.requestId,
      }),
    );
    await dataSource.query(`UPDATE audit_logs SET created_at = $1 WHERE id = $2`, [
      input.createdAt,
      saved.id,
    ]);
    return saved.id;
  }

  async function postGraphql(
    query: string,
    variables: Record<string, unknown> | undefined,
    token?: string,
  ) {
    const req = request(app!.getHttpServer() as App)
      .post('/graphql')
      .send({ query, variables });
    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }
    return req;
  }

  function expectGraphqlDenied(body: GraphqlBody, pattern: RegExp): void {
    expect(body.data?.adminAuditLogs ?? null).toBeNull();
    expect(body.errors?.length).toBeGreaterThan(0);
    const err = body.errors![0];
    const haystack = `${err.message} ${err.extensions?.code ?? ''}`;
    expect(haystack).toMatch(pattern);
  }

  it('filters GraphQL by requestId column, denies non-admin, and purges only 61-day-old rows', async () => {
    if (skipWithoutPostgres()) {
      return;
    }

    const seededIds = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM audit_logs WHERE id = ANY($1::uuid[])`,
      [[rowAId, rowBId, rowCId]],
    );
    expect(seededIds.map((row) => row.id).sort()).toEqual([rowAId, rowBId, rowCId].sort());

    const filteredRes = await postGraphql(
      ADMIN_AUDIT_LOGS_QUERY,
      { filter: { requestId: REQUEST_ID_B } },
      adminToken,
    );
    expect(filteredRes.status).toBe(200);
    const filteredBody = filteredRes.body as GraphqlBody;
    expect(filteredBody.errors).toBeUndefined();
    expect(filteredBody.data?.adminAuditLogs?.pagination.limit).toBe(20);
    expect(filteredBody.data?.adminAuditLogs?.items).toHaveLength(1);
    const matched = filteredBody.data!.adminAuditLogs!.items[0];
    expect(matched.id).toBe(rowBId);
    expect(matched.requestId).toBe(REQUEST_ID_B);
    const matchedMetadata = JSON.parse(matched.metadata ?? '{}') as {
      requestId?: string;
    };
    expect(matchedMetadata.requestId).toBe(REQUEST_ID_B);
    expect(matched.id).not.toBe(rowCId);
    expect(matched.requestId).not.toBe(REQUEST_ID_C);

    const unauthRes = await postGraphql(ADMIN_AUDIT_LOGS_QUERY, {
      filter: { requestId: REQUEST_ID_B },
    });
    expectGraphqlDenied(
      unauthRes.body as GraphqlBody,
      /Unauthorized|UNAUTHENTICATED|expired token/i,
    );

    const vendorRes = await postGraphql(
      ADMIN_AUDIT_LOGS_QUERY,
      { filter: { requestId: REQUEST_ID_B } },
      vendorToken,
    );
    expectGraphqlDenied(
      vendorRes.body as GraphqlBody,
      /Forbidden|FORBIDDEN|Insufficient permissions/i,
    );

    let deleted = 0;
    do {
      deleted = await auditLogsService.purgeExpired(PURGE_CUTOFF, AUDIT_LOG_RETENTION_BATCH_SIZE);
    } while (deleted > 0);

    const remaining = await dataSource.query<Array<{ id: string }>>(
      `SELECT id FROM audit_logs WHERE id = ANY($1::uuid[])`,
      [[rowAId, rowBId, rowCId]],
    );
    const remainingIds = remaining.map((row) => row.id).sort();
    expect(remainingIds).toEqual([rowBId, rowCId].sort());
    expect(remainingIds).not.toContain(rowAId);

    const listedRes = await postGraphql(
      ADMIN_AUDIT_LOGS_QUERY,
      { filter: { action: E2E_ACTION } },
      adminToken,
    );
    expect(listedRes.status).toBe(200);
    const listedBody = listedRes.body as GraphqlBody;
    expect(listedBody.errors).toBeUndefined();
    const listedIds = (listedBody.data?.adminAuditLogs?.items ?? []).map((item) => item.id);
    expect(listedIds).toEqual(expect.arrayContaining([rowBId, rowCId]));
    expect(listedIds).not.toContain(rowAId);
    expect(listedBody.data?.adminAuditLogs?.pagination.limit).toBe(20);

    expect(await countTableRows('order_audit_logs')).toBe(orderAuditCountBefore);
    expect(await countTableRows('admin_logs')).toBe(adminLogCountBefore);
  });
});
