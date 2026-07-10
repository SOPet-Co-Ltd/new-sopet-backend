import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { BadRequestException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Public, Roles } from '../../common/decorators';
import { SearchAnalyticsService } from './search-analytics.service';
import { SearchRepository } from './search.repository';
import { SearchSettingsService } from './search-settings.service';
import { SearchSuggestionsService } from './search-suggestions.service';
import { SearchSynonymService } from './search-synonym.service';
import {
  CreateSearchSynonymInput,
  SearchAnalyticsQueryRowType,
  SearchAnalyticsSummaryType,
  SearchRankingWeightsType,
  SearchSuggestionCtrRowType,
  SearchSuggestionsPayloadType,
  SearchSynonymType,
  UpdateSearchRankingWeightsInput,
  UpdateSearchSynonymInput,
} from './search.inputs';
import type { SearchRankingWeights } from './search.types';

@Resolver()
export class SearchResolver {
  constructor(
    private readonly searchSettingsService: SearchSettingsService,
    private readonly searchSuggestionsService: SearchSuggestionsService,
    private readonly searchSynonymService: SearchSynonymService,
    private readonly searchAnalyticsService: SearchAnalyticsService,
    private readonly searchRepository: SearchRepository,
  ) {}

  @Query(() => SearchSuggestionsPayloadType)
  @Public()
  async searchSuggestions(
    @Args('query') query: string,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 10 }) limit?: number,
    @Args('sessionId', { nullable: true }) sessionId?: string,
  ): Promise<SearchSuggestionsPayloadType> {
    const payload = await this.searchSuggestionsService.getSuggestions(query, limit, sessionId);

    this.searchAnalyticsService.recordSuggestionEvent({
      queryPrefix: query.trim().slice(0, 200),
      sessionId,
      clicked: false,
    });

    return payload;
  }

  @Query(() => [String])
  @Public()
  async searchRecoverySuggestions(@Args('query') query: string): Promise<string[]> {
    const analyticsSuggestions = await this.searchAnalyticsService.suggestRecoveryQueries(query, 5);
    if (analyticsSuggestions.length > 0) {
      return analyticsSuggestions;
    }

    return this.searchRepository.suggestFuzzyQueries(query, 5);
  }

  @Query(() => SearchRankingWeightsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchRankingWeights(): Promise<SearchRankingWeightsType> {
    const weights = await this.searchSettingsService.getRankingWeights();
    return this.mapWeights(weights);
  }

  @Mutation(() => SearchRankingWeightsType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateSearchRankingWeights(
    @Args('input') input: UpdateSearchRankingWeightsInput,
  ): Promise<SearchRankingWeightsType> {
    const weights = await this.searchSettingsService.updateRankingWeights(input);
    return this.mapWeights(weights);
  }

  @Query(() => [SearchSynonymType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchSynonyms(): Promise<SearchSynonymType[]> {
    const rows = await this.searchSynonymService.findAll();
    return rows.map((row) => this.mapSynonym(row));
  }

  @Mutation(() => SearchSynonymType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createSearchSynonym(
    @Args('input') input: CreateSearchSynonymInput,
  ): Promise<SearchSynonymType> {
    const row = await this.searchSynonymService.create(input);
    return this.mapSynonym(row);
  }

  @Mutation(() => SearchSynonymType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateSearchSynonym(
    @Args('id') id: string,
    @Args('input') input: UpdateSearchSynonymInput,
  ): Promise<SearchSynonymType> {
    const row = await this.searchSynonymService.update(id, input);
    return this.mapSynonym(row);
  }

  @Mutation(() => Boolean)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteSearchSynonym(@Args('id') id: string): Promise<boolean> {
    return this.searchSynonymService.delete(id);
  }

  @Query(() => SearchAnalyticsSummaryType)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchAnalyticsSummary(
    @Args('fromDate', { nullable: true }) fromDate?: Date,
    @Args('toDate', { nullable: true }) toDate?: Date,
  ): Promise<SearchAnalyticsSummaryType> {
    return this.searchAnalyticsService.getSummary(fromDate, toDate);
  }

  @Query(() => [SearchAnalyticsQueryRowType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchAnalyticsTopQueries(
    @Args('fromDate', { nullable: true }) fromDate?: Date,
    @Args('toDate', { nullable: true }) toDate?: Date,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
  ): Promise<SearchAnalyticsQueryRowType[]> {
    return this.searchAnalyticsService.getTopQueries(fromDate, toDate, limit);
  }

  @Query(() => [SearchAnalyticsQueryRowType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchAnalyticsZeroResultQueries(
    @Args('fromDate', { nullable: true }) fromDate?: Date,
    @Args('toDate', { nullable: true }) toDate?: Date,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 50 }) limit?: number,
  ): Promise<SearchAnalyticsQueryRowType[]> {
    return this.searchAnalyticsService.getZeroResultQueries(fromDate, toDate, limit);
  }

  @Query(() => [SearchSuggestionCtrRowType])
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async searchAnalyticsSuggestionCtr(
    @Args('fromDate', { nullable: true }) fromDate?: Date,
    @Args('toDate', { nullable: true }) toDate?: Date,
  ): Promise<SearchSuggestionCtrRowType[]> {
    return this.searchAnalyticsService.getSuggestionCtrByPrefix(fromDate, toDate);
  }

  @Query(() => String)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async exportSearchAnalyticsCsv(
    @Args('fromDate', { nullable: true }) fromDate?: Date,
    @Args('toDate', { nullable: true }) toDate?: Date,
  ): Promise<string> {
    return this.searchAnalyticsService.exportCsv(fromDate, toDate);
  }

  private mapWeights(weights: SearchRankingWeights): SearchRankingWeightsType {
    return {
      text: weights.text,
      prefixBoost: weights.prefixBoost,
      soldCount: weights.soldCount,
      averageRating: weights.averageRating,
      reviewCount: weights.reviewCount,
      personalizationCap: weights.personalizationCap,
      trigramFallbackThreshold: weights.trigramFallbackThreshold,
      trigramMinSimilarity: weights.trigramMinSimilarity,
      rrfK: weights.rrfK,
    };
  }

  private mapSynonym(row: {
    id: string;
    terms: string[];
    expansion: string;
    isActive: boolean;
    updatedAt: Date;
  }): SearchSynonymType {
    return {
      id: row.id,
      terms: row.terms,
      expansion: row.expansion,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
    };
  }
}
