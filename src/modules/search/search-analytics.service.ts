import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SearchEvent } from '../../database/entities/search-event.entity';
import { SearchSuggestionEvent } from '../../database/entities/search-suggestion-event.entity';
import type { SearchContextPayload } from './search.types';
import { resolveTrigramMinSimilarity } from './trigram-match.util';

export type SearchEventInput = {
  query: string;
  resultCount: number;
  latencyMs: number;
  filters?: Record<string, unknown>;
  sessionId?: string;
  userId?: string;
  suggestionClicked?: boolean;
};

export type SuggestionEventInput = {
  queryPrefix: string;
  suggestionQuery?: string;
  productId?: string;
  sessionId?: string;
  clicked?: boolean;
};

export type SearchAnalyticsDateRange = {
  fromDate: Date;
  toDate: Date;
};

export type SearchAnalyticsSummary = {
  totalSearches: number;
  uniqueQueries: number;
  zeroResultRate: number;
  avgResultsPerQuery: number;
  avgLatencyMs: number;
};

export type SearchAnalyticsQueryRow = {
  query: string;
  searchCount: number;
  avgResultCount: number;
};

export type SearchSuggestionCtrRow = {
  prefixBucket: string;
  impressions: number;
  clicks: number;
  ctr: number;
};

const DEFAULT_WINDOW_DAYS = 7;
const CSV_BOM = '\uFEFF';

@Injectable()
export class SearchAnalyticsService {
  private readonly logger = new Logger(SearchAnalyticsService.name);

  constructor(
    @InjectRepository(SearchEvent)
    private readonly searchEventRepository: Repository<SearchEvent>,
    @InjectRepository(SearchSuggestionEvent)
    private readonly searchSuggestionEventRepository: Repository<SearchSuggestionEvent>,
  ) {}

  resolveDateRange(fromDate?: Date, toDate?: Date): SearchAnalyticsDateRange {
    const end = toDate ?? new Date();
    const start = fromDate ?? new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    return { fromDate: start, toDate: end };
  }

  recordSearchEvent(input: SearchEventInput): void {
    void this.writeSearchEvent(input).catch((error) => {
      this.logger.warn(
        `Failed to record search event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }

  recordSuggestionEvent(input: SuggestionEventInput): void {
    void this.writeSuggestionEvent(input).catch((error) => {
      this.logger.warn(
        `Failed to record suggestion event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    });
  }

  async getSummary(fromDate?: Date, toDate?: Date): Promise<SearchAnalyticsSummary> {
    const range = this.resolveDateRange(fromDate, toDate);

    const row = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('COUNT(*)', 'totalSearches')
      .addSelect('COUNT(DISTINCT event.query)', 'uniqueQueries')
      .addSelect('AVG(event.resultCount)', 'avgResultsPerQuery')
      .addSelect('AVG(event.latencyMs)', 'avgLatencyMs')
      .addSelect(
        'SUM(CASE WHEN event.resultCount = 0 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)',
        'zeroResultRate',
      )
      .where('event.createdAt >= :fromDate', { fromDate: range.fromDate })
      .andWhere('event.createdAt <= :toDate', { toDate: range.toDate })
      .getRawOne<{
        totalSearches: string;
        uniqueQueries: string;
        avgResultsPerQuery: string;
        avgLatencyMs: string;
        zeroResultRate: string;
      }>();

    return {
      totalSearches: Number(row?.totalSearches ?? 0),
      uniqueQueries: Number(row?.uniqueQueries ?? 0),
      zeroResultRate: Number(row?.zeroResultRate ?? 0),
      avgResultsPerQuery: Number(row?.avgResultsPerQuery ?? 0),
      avgLatencyMs: Number(row?.avgLatencyMs ?? 0),
    };
  }

  async getTopQueries(
    fromDate?: Date,
    toDate?: Date,
    limit = 50,
  ): Promise<SearchAnalyticsQueryRow[]> {
    const range = this.resolveDateRange(fromDate, toDate);

    const rows = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('event.query', 'query')
      .addSelect('COUNT(*)', 'searchCount')
      .addSelect('AVG(event.resultCount)', 'avgResultCount')
      .where('event.createdAt >= :fromDate', { fromDate: range.fromDate })
      .andWhere('event.createdAt <= :toDate', { toDate: range.toDate })
      .groupBy('event.query')
      .orderBy('"searchCount"', 'DESC')
      .limit(limit)
      .getRawMany<{ query: string; searchCount: string; avgResultCount: string }>();

    return rows.map((row) => ({
      query: row.query,
      searchCount: Number(row.searchCount),
      avgResultCount: Number(row.avgResultCount),
    }));
  }

  async getZeroResultQueries(
    fromDate?: Date,
    toDate?: Date,
    limit = 50,
  ): Promise<SearchAnalyticsQueryRow[]> {
    const range = this.resolveDateRange(fromDate, toDate);

    const rows = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('event.query', 'query')
      .addSelect('COUNT(*)', 'searchCount')
      .addSelect('AVG(event.resultCount)', 'avgResultCount')
      .where('event.createdAt >= :fromDate', { fromDate: range.fromDate })
      .andWhere('event.createdAt <= :toDate', { toDate: range.toDate })
      .andWhere('event.resultCount = 0')
      .groupBy('event.query')
      .orderBy('"searchCount"', 'DESC')
      .limit(limit)
      .getRawMany<{ query: string; searchCount: string; avgResultCount: string }>();

    return rows.map((row) => ({
      query: row.query,
      searchCount: Number(row.searchCount),
      avgResultCount: Number(row.avgResultCount),
    }));
  }

  async getSuggestionCtrByPrefix(
    fromDate?: Date,
    toDate?: Date,
  ): Promise<SearchSuggestionCtrRow[]> {
    const range = this.resolveDateRange(fromDate, toDate);

    const rows = await this.searchSuggestionEventRepository
      .createQueryBuilder('event')
      .select('LOWER(LEFT(event.queryPrefix, 2))', 'prefixBucket')
      .addSelect('COUNT(*)', 'impressions')
      .addSelect('SUM(CASE WHEN event.clicked THEN 1 ELSE 0 END)', 'clicks')
      .where('event.createdAt >= :fromDate', { fromDate: range.fromDate })
      .andWhere('event.createdAt <= :toDate', { toDate: range.toDate })
      .groupBy('"prefixBucket"')
      .orderBy('"impressions"', 'DESC')
      .getRawMany<{ prefixBucket: string; impressions: string; clicks: string }>();

    return rows.map((row) => {
      const impressions = Number(row.impressions);
      const clicks = Number(row.clicks);
      return {
        prefixBucket: row.prefixBucket || '(empty)',
        impressions,
        clicks,
        ctr: impressions > 0 ? clicks / impressions : 0,
      };
    });
  }

  async suggestRecoveryQueries(query: string, limit = 5): Promise<string[]> {
    const normalized = query.trim();
    if (!normalized) {
      return [];
    }

    const tokens = normalized
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);

    if (tokens.length === 0) {
      return [];
    }

    const rows = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('event.query', 'query')
      .addSelect('COUNT(*)', 'searchCount')
      .addSelect('SUM(CASE WHEN event.suggestionClicked THEN 1 ELSE 0 END)', 'conversionCount')
      .where('event.resultCount > 0')
      .andWhere('LOWER(event.query) <> LOWER(:normalized)', { normalized })
      .andWhere("event.createdAt >= NOW() - INTERVAL '30 days'")
      .groupBy('event.query')
      .orderBy('"conversionCount"', 'DESC')
      .addOrderBy('"searchCount"', 'DESC')
      .limit(30)
      .getRawMany<{ query: string; searchCount: string; conversionCount: string }>();

    const suggestions: string[] = [];

    for (const row of rows) {
      const candidate = row.query.trim();
      if (!candidate) {
        continue;
      }

      const candidateLower = candidate.toLowerCase();
      const overlaps = tokens.some((token) => candidateLower.includes(token));
      if (!overlaps) {
        continue;
      }

      if (!suggestions.includes(candidate)) {
        suggestions.push(candidate);
      }

      if (suggestions.length >= limit) {
        break;
      }
    }

    if (suggestions.length >= limit) {
      return suggestions.slice(0, limit);
    }

    const fuzzyMinSimilarity = resolveTrigramMinSimilarity(0.25, normalized);
    const fuzzyRows = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('event.query', 'query')
      .addSelect('COUNT(*)', 'searchCount')
      .where('event.resultCount > 0')
      .andWhere('LOWER(event.query) <> LOWER(:normalized)', { normalized })
      .andWhere("event.createdAt >= NOW() - INTERVAL '30 days'")
      .andWhere(
        `(GREATEST(
          similarity(LOWER(event.query), LOWER(:normalized)),
          word_similarity(LOWER(:normalized), LOWER(event.query))
        ) >= :fuzzyMinSimilarity)`,
        { fuzzyMinSimilarity },
      )
      .groupBy('event.query')
      .orderBy('"searchCount"', 'DESC')
      .limit(limit)
      .getRawMany<{ query: string }>();

    for (const row of fuzzyRows) {
      const candidate = row.query.trim();
      if (!candidate || suggestions.includes(candidate)) {
        continue;
      }

      suggestions.push(candidate);
      if (suggestions.length >= limit) {
        break;
      }
    }

    return suggestions.slice(0, limit);
  }

  async exportCsv(fromDate?: Date, toDate?: Date): Promise<string> {
    const range = this.resolveDateRange(fromDate, toDate);

    const rows = await this.searchEventRepository
      .createQueryBuilder('event')
      .select('event.query', 'query')
      .addSelect('event.resultCount', 'resultCount')
      .addSelect('event.latencyMs', 'latencyMs')
      .addSelect('event.sessionId', 'sessionId')
      .addSelect('event.suggestionClicked', 'suggestionClicked')
      .addSelect('event.createdAt', 'createdAt')
      .where('event.createdAt >= :fromDate', { fromDate: range.fromDate })
      .andWhere('event.createdAt <= :toDate', { toDate: range.toDate })
      .orderBy('event.createdAt', 'DESC')
      .getRawMany<{
        query: string;
        resultCount: number;
        latencyMs: number;
        sessionId: string | null;
        suggestionClicked: boolean;
        createdAt: Date;
      }>();

    const header = 'query,result_count,latency_ms,session_id,suggestion_clicked,created_at';
    const lines = rows.map((row) =>
      [
        this.escapeCsv(row.query),
        row.resultCount,
        row.latencyMs,
        this.escapeCsv(row.sessionId ?? ''),
        row.suggestionClicked ? 'true' : 'false',
        row.createdAt.toISOString(),
      ].join(','),
    );

    return `${CSV_BOM}${header}\n${lines.join('\n')}`;
  }

  private async writeSearchEvent(input: SearchEventInput): Promise<void> {
    await this.searchEventRepository.save({
      query: input.query.trim().slice(0, 500),
      resultCount: input.resultCount,
      latencyMs: input.latencyMs,
      filters: input.filters ?? {},
      sessionId: input.sessionId,
      userId: input.userId,
      suggestionClicked: input.suggestionClicked ?? false,
    });
  }

  private async writeSuggestionEvent(input: SuggestionEventInput): Promise<void> {
    await this.searchSuggestionEventRepository.save({
      queryPrefix: input.queryPrefix.trim().slice(0, 200),
      suggestionQuery: input.suggestionQuery?.trim().slice(0, 500),
      productId: input.productId,
      sessionId: input.sessionId,
      clicked: input.clicked ?? false,
    });
  }

  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
