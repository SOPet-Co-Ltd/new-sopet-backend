import 'reflect-metadata';
import { SearchResolver } from './search.resolver';
import { SearchSettingsService } from './search-settings.service';
import { SearchSuggestionsService } from './search-suggestions.service';
import { SearchSynonymService } from './search-synonym.service';
import { SearchAnalyticsService } from './search-analytics.service';
import { SearchRepository } from './search.repository';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuditAction, AuditResourceType } from '../audit-logs/audit-log.constants';
import { AuditActorType } from '../../database/entities/audit-log.entity';
import { DEFAULT_SEARCH_RANKING_WEIGHTS } from './search.types';
import type { GraphqlContext } from '../../graphql/loaders/graphql-context.types';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_EMAIL = 'admin@sopet.org';
const SYNONYM_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const graphqlContext: GraphqlContext = {
  req: { requestId: 'req-search-1', headers: { 'x-forwarded-for': '203.0.113.10' } },
  res: {},
  loaders: { productSoldCount: { load: jest.fn() } as never },
};

const synonymRow = {
  id: SYNONYM_ID,
  terms: ['dog food', 'kibble'],
  expansion: 'dog food',
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('SearchResolver audit logging', () => {
  let resolver: SearchResolver;
  let searchSettingsService: { getRankingWeights: jest.Mock; updateRankingWeights: jest.Mock };
  let searchSynonymService: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let searchAnalyticsService: { resetAll: jest.Mock };
  let auditLogsService: { log: jest.Mock };

  beforeEach(() => {
    searchSettingsService = {
      getRankingWeights: jest.fn(),
      updateRankingWeights: jest.fn(),
    };
    searchSynonymService = {
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    searchAnalyticsService = { resetAll: jest.fn().mockResolvedValue(undefined) };
    auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };

    resolver = new SearchResolver(
      searchSettingsService as unknown as SearchSettingsService,
      {} as SearchSuggestionsService,
      searchSynonymService as unknown as SearchSynonymService,
      searchAnalyticsService as unknown as SearchAnalyticsService,
      {} as SearchRepository,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  it('logs search.ranking_weights.updated with resourceId null and settingsKey (AC-B-004)', async () => {
    searchSettingsService.updateRankingWeights.mockResolvedValue(DEFAULT_SEARCH_RANKING_WEIGHTS);

    await resolver.updateSearchRankingWeights(ADMIN_ID, ADMIN_EMAIL, { text: 40 }, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuditActorType.ADMIN,
        actorId: ADMIN_ID,
        actorLabel: ADMIN_EMAIL,
        action: AuditAction.SEARCH_RANKING_WEIGHTS_UPDATED,
        resourceType: AuditResourceType.SEARCH,
        resourceId: null,
        metadata: { settingsKey: 'search.ranking_weights' },
        requestId: 'req-search-1',
      }),
    );
  });

  it('logs search.synonym.created with synonym uuid and terms', async () => {
    searchSynonymService.create.mockResolvedValue(synonymRow);

    await resolver.createSearchSynonym(
      ADMIN_ID,
      ADMIN_EMAIL,
      { terms: synonymRow.terms, expansion: synonymRow.expansion },
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SEARCH_SYNONYM_CREATED,
        resourceType: AuditResourceType.SEARCH,
        resourceId: SYNONYM_ID,
        metadata: { terms: synonymRow.terms },
      }),
    );
  });

  it('logs search.synonym.updated with synonym uuid', async () => {
    searchSynonymService.update.mockResolvedValue(synonymRow);

    await resolver.updateSearchSynonym(
      ADMIN_ID,
      ADMIN_EMAIL,
      SYNONYM_ID,
      { expansion: 'kibble' },
      graphqlContext,
    );

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SEARCH_SYNONYM_UPDATED,
        resourceType: AuditResourceType.SEARCH,
        resourceId: SYNONYM_ID,
        metadata: { terms: synonymRow.terms },
      }),
    );
  });

  it('logs search.synonym.deleted with the input id', async () => {
    searchSynonymService.delete.mockResolvedValue(true);

    await resolver.deleteSearchSynonym(ADMIN_ID, ADMIN_EMAIL, SYNONYM_ID, graphqlContext);

    expect(auditLogsService.log).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SEARCH_SYNONYM_DELETED,
        resourceType: AuditResourceType.SEARCH,
        resourceId: SYNONYM_ID,
      }),
    );
  });

  it('does not log when resetSearchAnalytics succeeds', async () => {
    await resolver.resetSearchAnalytics();

    expect(searchAnalyticsService.resetAll).toHaveBeenCalledTimes(1);
    expect(auditLogsService.log).not.toHaveBeenCalled();
  });
});
