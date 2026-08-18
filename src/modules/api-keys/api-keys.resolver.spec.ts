import { ApiKeysResolver } from './api-keys.resolver';
import { ApiKeysService } from './api-keys.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const VENDOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENDOR_EMAIL = 'vendor@sopet.org';
const STORE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const API_KEY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = 'sopet_sk_super_secret_raw_key_value_never_log';
const KEY_PREFIX = 'sopet_sk_super_secret';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-api-key-1', headers: { 'x-forwarded-for': '198.51.100.20' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

describe('ApiKeysResolver audit logging (AC-B-009)', () => {
  let resolver: ApiKeysResolver;
  let apiKeysService: {
    create: jest.Mock;
    revoke: jest.Mock;
    listForStore: jest.Mock;
  };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    apiKeysService = {
      create: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      listForStore: jest.fn(),
    };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = new ApiKeysResolver(
      apiKeysService as unknown as ApiKeysService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('logs api_key.created once without secret or keyHash', async () => {
    apiKeysService.create.mockResolvedValue({
      apiKey: {
        id: API_KEY_ID,
        storeId: STORE_ID,
        name: 'CI key',
        keyPrefix: KEY_PREFIX,
        keyHash: 'bcrypt-hash-must-not-appear',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        lastUsedAt: null,
        revokedAt: null,
      },
      secret: SECRET,
    });

    const result = await resolver.createStoreApiKey(
      STORE_ID,
      'CI key',
      VENDOR_ID,
      VENDOR_EMAIL,
      graphqlContext,
    );

    expect(result.secret).toBe(SECRET);
    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.VENDOR,
        actorId: VENDOR_ID,
        actorLabel: VENDOR_EMAIL,
        action: AuditAction.API_KEY_CREATED,
        resourceType: AuditResourceType.API_KEY,
        resourceId: API_KEY_ID,
        metadata: {
          storeId: STORE_ID,
          name: 'CI key',
          keyPrefix: KEY_PREFIX,
        },
        requestId: 'req-api-key-1',
      }),
    );

    const logArg = (
      auditLogsService.log.mock.calls as Array<[{ metadata: Record<string, unknown> }]>
    )[0][0];
    expect(logArg.metadata).not.toHaveProperty('secret');
    expect(logArg.metadata).not.toHaveProperty('keyHash');
    expect(JSON.stringify(logArg.metadata)).not.toContain(SECRET);
    expect(JSON.stringify(logArg.metadata)).not.toContain('bcrypt-hash');
  });

  it('logs api_key.revoked once without secret or keyHash', async () => {
    await resolver.revokeStoreApiKey(STORE_ID, API_KEY_ID, VENDOR_ID, VENDOR_EMAIL, graphqlContext);

    expect(apiKeysService.revoke).toHaveBeenCalledWith(VENDOR_ID, STORE_ID, API_KEY_ID);
    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.VENDOR,
        actorId: VENDOR_ID,
        action: AuditAction.API_KEY_REVOKED,
        resourceType: AuditResourceType.API_KEY,
        resourceId: API_KEY_ID,
        metadata: { storeId: STORE_ID },
        requestId: 'req-api-key-1',
      }),
    );

    const logArg = (
      auditLogsService.log.mock.calls as Array<[{ metadata: Record<string, unknown> }]>
    )[0][0];
    expect(logArg.metadata).not.toHaveProperty('secret');
    expect(logArg.metadata).not.toHaveProperty('keyHash');
  });
});
