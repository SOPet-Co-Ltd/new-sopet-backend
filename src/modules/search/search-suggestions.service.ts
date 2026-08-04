import { BadRequestException, Injectable } from '@nestjs/common';
import { SearchRepository } from './search.repository';
import { SearchSynonymService } from './search-synonym.service';
import type { SearchSuggestionsPayload } from './search.types';
import { queryGraphemeLength } from './trigram-match.util';

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
    if (queryGraphemeLength(trimmed) < MIN_QUERY_LENGTH) {
      throw new BadRequestException('Query must be at least 2 characters');
    }

    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    // Lexical match uses the typed query so Thai/English name substrings stay intact.
    // Synonym expansion is appended as alternate match terms (not concatenating into one string).
    const expandedQuery = await this.searchSynonymService.expandQuery(trimmed);
    const lexicalQueries = uniqueLexicalQueries(trimmed, expandedQuery);

    const [productGroups, queryGroups] = await Promise.all([
      Promise.all(
        lexicalQueries.map((lexicalQuery) =>
          this.searchRepository.suggestProducts(lexicalQuery, cappedLimit),
        ),
      ),
      Promise.all(
        lexicalQueries.map((lexicalQuery) =>
          this.searchRepository.suggestQueries(lexicalQuery, Math.min(cappedLimit, 5)),
        ),
      ),
    ]);

    return {
      products: mergeUniqueById(productGroups, cappedLimit),
      queries: mergeUniqueByQuery(queryGroups, Math.min(cappedLimit, 5)),
    };
  }
}

function uniqueLexicalQueries(trimmed: string, expandedQuery: string): string[] {
  if (expandedQuery === trimmed) {
    return [trimmed];
  }

  const originalTokens = new Set(
    trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.toLowerCase()),
  );
  const queries = [trimmed];

  for (const token of expandedQuery.split(/\s+/).filter(Boolean)) {
    const normalized = token.toLowerCase();
    if (originalTokens.has(normalized)) {
      continue;
    }
    if (!queries.some((item) => item.toLowerCase() === normalized)) {
      queries.push(token);
    }
  }

  return queries;
}

function mergeUniqueById<T extends { id: string }>(groups: T[][], limit: number): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      merged.push(item);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }
  return merged;
}

function mergeUniqueByQuery<T extends { query: string }>(groups: T[][], limit: number): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = item.query.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }
  return merged;
}
