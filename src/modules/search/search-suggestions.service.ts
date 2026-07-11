import { BadRequestException, Injectable } from '@nestjs/common';
import { SearchRepository } from './search.repository';
import { SearchSynonymService } from './search-synonym.service';
import type { SearchSuggestionsPayload } from './search.types';

const MIN_QUERY_LENGTH = 2;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

@Injectable()
export class SearchSuggestionsService {
  constructor(
    private readonly searchRepository: SearchRepository,
    private readonly searchSynonymService: SearchSynonymService,
  ) {}

  async getSuggestions(
    query: string,
    limit = DEFAULT_LIMIT,
    sessionId?: string,
  ): Promise<SearchSuggestionsPayload> {
    // sessionId is forwarded for future suggestion personalization; not used yet.
    void sessionId;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      throw new BadRequestException('Query must be at least 2 characters');
    }

    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const expandedQuery = await this.searchSynonymService.expandQuery(trimmed);

    const [products, queries] = await Promise.all([
      this.searchRepository.suggestProducts(expandedQuery, cappedLimit),
      this.searchRepository.suggestQueries(expandedQuery, Math.min(cappedLimit, 5)),
    ]);

    return { products, queries };
  }
}
