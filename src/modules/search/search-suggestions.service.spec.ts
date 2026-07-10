import { BadRequestException } from '@nestjs/common';
import { SearchSuggestionsService } from './search-suggestions.service';
import type { SearchRepository } from './search.repository';
import type { SearchSynonymService } from './search-synonym.service';

describe('SearchSuggestionsService', () => {
  const createService = () => {
    const searchRepository = {
      suggestProducts: jest.fn(async () => [
        {
          id: 'prod-1',
          name: 'Royal Canin Cat Food',
          slug: 'royal-canin-cat-food',
          thumbnailUrl: 'https://example.com/royal-canin.jpg',
        },
      ]),
      suggestQueries: jest.fn(async () => [{ query: 'royal canin' }]),
    } as unknown as SearchRepository;

    const searchSynonymService = {
      expandQuery: jest.fn(async (query: string) => query),
    } as unknown as SearchSynonymService;

    return {
      service: new SearchSuggestionsService(searchRepository, searchSynonymService),
      searchRepository,
      searchSynonymService,
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

  it('clamps limit to 20', async () => {
    const { service, searchRepository } = createService();
    await service.getSuggestions('royal', 50);

    expect(searchRepository.suggestProducts).toHaveBeenCalledWith('royal', 20);
  });
});
