import { BadRequestException } from '@nestjs/common';
import { SearchSuggestionsService } from './search-suggestions.service';
import type { SearchRepository } from './search.repository';
import type { SearchSynonymService } from './search-synonym.service';

describe('SearchSuggestionsService', () => {
  const createService = () => {
    const suggestProducts = jest.fn().mockResolvedValue([
      {
        id: 'prod-1',
        name: 'Royal Canin Cat Food',
        slug: 'royal-canin-cat-food',
        thumbnailUrl: 'https://example.com/royal-canin.jpg',
      },
    ]);
    const suggestQueries = jest.fn().mockResolvedValue([{ query: 'royal canin' }]);
    const expandQuery = jest.fn((query: string) => Promise.resolve(query));

    const searchRepository = {
      suggestProducts,
      suggestQueries,
    } as unknown as SearchRepository;

    const searchSynonymService = {
      expandQuery,
    } as unknown as SearchSynonymService;

    return {
      service: new SearchSuggestionsService(searchRepository, searchSynonymService),
      suggestProducts,
      expandQuery,
    };
  };

  it('returns product suggestions with optional thumbnail urls', async () => {
    const { service } = createService();
    const result = await service.getSuggestions('ro', 10);

    expect(result.products[0]).toEqual({
      id: 'prod-1',
      name: 'Royal Canin Cat Food',
      slug: 'royal-canin-cat-food',
      thumbnailUrl: 'https://example.com/royal-canin.jpg',
    });
  });

  it('rejects queries shorter than 2 characters', async () => {
    const { service } = createService();
    await expect(service.getSuggestions('r')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts Thai queries of at least 2 graphemes', async () => {
    const { service, suggestProducts } = createService();
    await service.getSuggestions('แมว', 10);

    expect(suggestProducts).toHaveBeenCalledWith('แมว', 10);
  });

  it('clamps limit to 20', async () => {
    const { service, suggestProducts } = createService();
    await service.getSuggestions('royal', 50);

    expect(suggestProducts).toHaveBeenCalledWith('royal', 20);
  });

  it('matches synonym expansion tokens as alternate lexical queries', async () => {
    const { service, suggestProducts, expandQuery } = createService();
    expandQuery.mockResolvedValueOnce('royal Royal Canin');

    await service.getSuggestions('royal', 10);

    expect(suggestProducts).toHaveBeenCalledWith('royal', 10);
    expect(suggestProducts).toHaveBeenCalledWith('Canin', 10);
    expect(suggestProducts).toHaveBeenCalledTimes(2);
  });
});
