import { StoresResolver } from './stores.resolver';
import { StoresService } from './stores.service';
import { StoreTeamService } from './store-team.service';
import { ShippingOptionsService } from './shipping-options.service';
import { ShippingProvidersService } from './shipping-providers.service';
import { StoreRequestService } from './store-request.service';
import { StoreReactivationRequestService } from './store-reactivation-request.service';
import { VendorInvitationService } from './vendor-invitation.service';
import { AuthService } from '../auth/auth.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { StoreReactivationRequestStatus } from '../../database/entities/store-reactivation-request.entity';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const STORE_ID = '44444444-4444-4444-8444-444444444444';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-stores-1', headers: { 'x-forwarded-for': '203.0.113.50' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

function buildResolver(deps: {
  shippingProvidersService: Partial<ShippingProvidersService>;
  shippingOptionsService?: Partial<ShippingOptionsService>;
  storeReactivationRequestService?: Partial<StoreReactivationRequestService>;
  auditLogsService: { log: jest.Mock };
}): StoresResolver {
  return new StoresResolver(
    {} as StoresService,
    {} as StoreTeamService,
    (deps.shippingOptionsService ?? {}) as ShippingOptionsService,
    deps.shippingProvidersService as ShippingProvidersService,
    {} as StoreRequestService,
    (deps.storeReactivationRequestService ?? {}) as StoreReactivationRequestService,
    {} as VendorInvitationService,
    {} as AuthService,
    deps.auditLogsService as unknown as AuditLogsService,
  );
}

describe('StoresResolver shipping provider audit (AC-B-007)', () => {
  let shippingProvidersService: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let shippingOptionsService: {
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let auditLogsService: { log: jest.Mock };
  let resolver: StoresResolver;

  const provider = {
    id: PROVIDER_ID,
    name: 'Kerry',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    shippingProvidersService = {
      create: jest.fn().mockResolvedValue(provider),
      update: jest.fn().mockResolvedValue({ ...provider, name: 'Flash' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    shippingOptionsService = {
      create: jest.fn().mockResolvedValue({
        id: 'opt-1',
        storeId: STORE_ID,
        name: 'Standard',
        description: null,
        price: 40,
        sortOrder: 0,
        isActive: true,
        providerId: null,
      }),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = buildResolver({
      shippingProvidersService,
      shippingOptionsService,
      auditLogsService,
    });
  });

  it('logs shipping_provider.create/update/delete once each', async () => {
    await resolver.createShippingProvider({ name: 'Kerry' }, ADMIN_ID, ADMIN_EMAIL, graphqlContext);
    await resolver.updateShippingProvider(
      PROVIDER_ID,
      { name: 'Flash' },
      ADMIN_ID,
      ADMIN_EMAIL,
      graphqlContext,
    );
    await resolver.deleteShippingProvider(PROVIDER_ID, ADMIN_ID, ADMIN_EMAIL, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(3);
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        action: AuditAction.SHIPPING_PROVIDER_CREATED,
        resourceType: AuditResourceType.SHIPPING_PROVIDER,
        resourceId: PROVIDER_ID,
        metadata: { name: 'Kerry' },
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: AuditAction.SHIPPING_PROVIDER_UPDATED,
        resourceId: PROVIDER_ID,
        metadata: { name: 'Flash' },
      }),
    );
    expect(auditLogsService.log).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        action: AuditAction.SHIPPING_PROVIDER_DELETED,
        resourceType: AuditResourceType.SHIPPING_PROVIDER,
        resourceId: PROVIDER_ID,
      }),
    );
  });

  it('does not log store-level shipping option mutations', async () => {
    await resolver.adminCreateStoreShippingOption(STORE_ID, {
      name: 'Standard',
      price: 40,
    });

    expect(shippingOptionsService.create).toHaveBeenCalled();
    expect(auditLogsService.log).not.toHaveBeenCalled();
  });
});

describe('StoresResolver reactivation audit (AC-B-008 unit)', () => {
  let storeReactivationRequestService: {
    approve: jest.Mock;
    reject: jest.Mock;
  };
  let auditLogsService: { log: jest.Mock };
  let resolver: StoresResolver;

  const request = {
    id: REQUEST_ID,
    storeId: STORE_ID,
    store: { name: 'Pet Store' },
    submittedByUserId: 'vendor-1',
    title: 'Please reopen',
    content: 'We fixed issues',
    status: StoreReactivationRequestStatus.APPROVED,
    reviewNote: null,
    images: [],
  };

  beforeEach(() => {
    storeReactivationRequestService = {
      approve: jest.fn().mockResolvedValue(request),
      reject: jest.fn().mockResolvedValue({
        ...request,
        status: StoreReactivationRequestStatus.REJECTED,
        reviewNote: 'Incomplete docs',
      }),
    };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
    resolver = buildResolver({
      shippingProvidersService: {},
      storeReactivationRequestService,
      auditLogsService,
    });
  });

  it('logs store.reactivation_approved with request/store ids after approve', async () => {
    await resolver.approveStoreReactivationRequest(
      REQUEST_ID,
      ADMIN_ID,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(storeReactivationRequestService.approve).toHaveBeenCalledWith(REQUEST_ID, ADMIN_ID);
    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.STORE_REACTIVATION_APPROVED,
        resourceType: AuditResourceType.REACTIVATION_REQUEST,
        resourceId: REQUEST_ID,
        metadata: {
          storeId: STORE_ID,
          reactivationRequestId: REQUEST_ID,
        },
      }),
    );
  });

  it('logs store.reactivation_rejected on reject', async () => {
    await resolver.rejectStoreReactivationRequest(
      { id: REQUEST_ID, reviewNote: 'Incomplete docs' },
      ADMIN_ID,
      ADMIN_EMAIL,
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.STORE_REACTIVATION_REJECTED,
        resourceType: AuditResourceType.REACTIVATION_REQUEST,
        resourceId: REQUEST_ID,
        metadata: {
          storeId: STORE_ID,
          reactivationRequestId: REQUEST_ID,
          reviewNote: 'Incomplete docs',
        },
      }),
    );
  });
});
