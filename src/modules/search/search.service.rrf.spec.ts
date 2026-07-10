import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import { DEFAULT_SEARCH_RANKING_WEIGHTS } from './search.types';

describe('SearchService RRF path', () => {
  const weights = DEFAULT_SEARCH_RANKING_WEIGHTS;

  const searchRepository = {
    countFtsMatches: jest.fn(),
    fetchFtsLegIds: jest.fn(),
    fetchTrigramLegIds: jest.fn(),
    fetchSemanticLegIds: jest.fn(),
    fetchProductPersonalizationMeta: jest.fn(),
    createPublicListingQuery: jest.fn(),
    applyListingFilters: jest.fn(),
    applySorting: jest.fn(),
  };

  const searchSettingsService = {
    getRankingWeights: jest.fn().mockResolvedValue(weights),
  };

  const searchSynonymService = {
    expandQuery: jest.fn().mockResolvedValue('cat food'),
  };

  const embeddingService = {
    isConfigured: jest.fn().mockReturnValue(false),
    embedText: jest.fn(),
  };

  const rrfEngine = {
    merge: jest.fn().mockReturnValue(['p2', 'p1']),
    scoreMap: jest.fn().mockReturnValue(
      new Map([
        ['p2', 0.9],
        ['p1', 0.8],
      ]),
    ),
  };

  const personalizationService = {
    buildProfile: jest.fn(),
    reorderIds: jest.fn(),
    persistUserContext: jest.fn(),
  };

  const productRepository = {
    createQueryBuilder: jest.fn(),
  };

  const configService = {
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  } as unknown as ConfigService;

  const service = new SearchService(
    configService,
    searchRepository as never,
    searchSettingsService as never,
    searchSynonymService as never,
    embeddingService as never,
    rrfEngine as never,
    personalizationService as never,
    productRepository as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('degrades to fts and trigram legs when embeddings are unavailable', async () => {
    searchRepository.countFtsMatches.mockResolvedValue(1);
    searchRepository.fetchFtsLegIds.mockResolvedValue(['p1']);
    searchRepository.fetchTrigramLegIds.mockResolvedValue(['p2']);

    const countQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ cnt: '2' }),
    };
    searchRepository.createPublicListingQuery.mockReturnValue(countQueryBuilder);
    searchRepository.applyListingFilters.mockImplementation(() => undefined);

    const hydrateQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'p2' }, { id: 'p1' }]),
    };
    productRepository.createQueryBuilder.mockReturnValue(hydrateQueryBuilder);

    const result = await service.searchProducts({
      search: 'cat food',
      sortBy: 'relevance',
      page: 1,
      limit: 20,
    });

    expect(searchRepository.fetchFtsLegIds).toHaveBeenCalled();
    expect(searchRepository.fetchTrigramLegIds).toHaveBeenCalled();
    expect(searchRepository.fetchSemanticLegIds).not.toHaveBeenCalled();
    expect(rrfEngine.merge).toHaveBeenCalled();
    expect(result.items).toHaveLength(2);
  });
});
