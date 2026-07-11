import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Product } from '../../database/entities/product.entity';
import { PaginatedResponse } from '../../common/interfaces';
import { ProductQueryDto } from '../products/dto/product-query.dto';
import { EmbeddingService } from './embedding/embedding.service';
import { PersonalizationService } from './personalization.service';
import { RrfEngine } from './rrf.engine';
import { SearchRepository } from './search.repository';
import { SearchSettingsService } from './search-settings.service';
import { SearchSynonymService } from './search-synonym.service';
import { resolveTrigramMinSimilarity, shouldForceTrigramFallback } from './trigram-match.util';
import type { SearchMatchOptions, SearchRankingWeights } from './search.types';

@Injectable()
export class SearchService {
  constructor(
    private readonly configService: ConfigService,
    private readonly searchRepository: SearchRepository,
    private readonly searchSettingsService: SearchSettingsService,
    private readonly searchSynonymService: SearchSynonymService,
    private readonly embeddingService: EmbeddingService,
    private readonly rrfEngine: RrfEngine,
    private readonly personalizationService: PersonalizationService,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  isSmartSearchEnabled(): boolean {
    return this.configService.get<boolean>('search.smartEnabled', false);
  }

  async searchProducts(queryDto: ProductQueryDto): Promise<PaginatedResponse<Product>> {
    const {
      search,
      storeId,
      category,
      categoryId,
      tag,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
      sessionId,
      searchContext,
    } = queryDto;

    const filters: ProductQueryDto = {
      search,
      storeId,
      category,
      categoryId,
      tag,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    };

    const weights = await this.searchSettingsService.getRankingWeights();
    const skip = (page - 1) * limit;
    const normalizedSortBy = sortBy ?? 'relevance';
    const useRrfPath =
      Boolean(search?.trim()) &&
      this.rankingEngineShouldUseRrf(normalizedSortBy, search) &&
      normalizedSortBy === 'relevance';

    const expandedQuery = search?.trim() ? await this.searchSynonymService.expandQuery(search) : '';

    if (useRrfPath) {
      return this.searchProductsWithRrf({
        filters,
        expandedQuery,
        search: search!.trim(),
        weights,
        skip,
        page,
        limit,
        sessionId,
        searchContext,
        userId: queryDto.userId,
      });
    }

    let searchMatch: SearchMatchOptions | undefined;

    if (search?.trim()) {
      searchMatch = await this.buildSearchMatch(search.trim(), expandedQuery, filters, weights);
    }

    const idQueryBuilder = this.searchRepository.createPublicListingQuery();
    idQueryBuilder.select('product.id', 'id');
    this.searchRepository.applyListingFilters(idQueryBuilder, filters, 'product', searchMatch);
    this.searchRepository.applySorting(
      idQueryBuilder,
      normalizedSortBy,
      sortOrder,
      search,
      weights,
      'product',
      searchMatch,
    );
    idQueryBuilder.offset(skip).limit(limit);

    const idRows = await idQueryBuilder.getRawMany<{ id: string }>();
    const ids = idRows.map((row) => row.id);

    const countQueryBuilder = this.searchRepository.createPublicListingQuery();
    this.searchRepository.applyListingFilters(countQueryBuilder, filters, 'product', searchMatch);
    const totalRow = await countQueryBuilder
      .select('COUNT(product.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRow?.cnt ?? 0);

    if (ids.length === 0) {
      return {
        items: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    const items = await this.hydrateProducts(ids);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async searchProductsWithRrf(input: {
    filters: ProductQueryDto;
    expandedQuery: string;
    search: string;
    weights: Awaited<ReturnType<SearchSettingsService['getRankingWeights']>>;
    skip: number;
    page: number;
    limit: number;
    sessionId?: string;
    searchContext?: ProductQueryDto['searchContext'];
    userId?: string;
  }): Promise<PaginatedResponse<Product>> {
    const candidateLimit = this.configService.get<number>('search.rrfCandidateLimit', 100);
    const searchMatch = await this.buildSearchMatch(
      input.search,
      input.expandedQuery,
      input.filters,
      input.weights,
    );

    const countQueryBuilder = this.searchRepository.createPublicListingQuery();
    this.searchRepository.applyListingFilters(
      countQueryBuilder,
      input.filters,
      'product',
      searchMatch,
    );
    const totalRow = await countQueryBuilder
      .select('COUNT(product.id)', 'cnt')
      .getRawOne<{ cnt: string }>();
    const total = Number(totalRow?.cnt ?? 0);

    const legs: string[][] = [];
    const ftsLeg = await this.searchRepository.fetchFtsLegIds(
      input.filters,
      input.expandedQuery,
      candidateLimit,
    );
    if (ftsLeg.length > 0) {
      legs.push(ftsLeg);
    }

    if (searchMatch.includeTrigram) {
      const trigramLeg = await this.searchRepository.fetchTrigramLegIds(
        input.filters,
        input.expandedQuery,
        searchMatch.minSimilarity,
        candidateLimit,
      );
      if (trigramLeg.length > 0) {
        legs.push(trigramLeg);
      }
    }

    if (this.embeddingService.isConfigured()) {
      const queryEmbedding = await this.embeddingService.embedText(input.expandedQuery);
      if (queryEmbedding) {
        const semanticLeg = await this.searchRepository.fetchSemanticLegIds(
          input.filters,
          queryEmbedding,
          candidateLimit,
        );
        if (semanticLeg.length > 0) {
          legs.push(semanticLeg);
        }
      }
    }

    const mergedIds = legs.length > 0 ? this.rrfEngine.merge(legs, input.weights.rrfK) : [];
    const scoreById = this.rrfEngine.scoreMap(legs, input.weights.rrfK);

    let orderedIds = mergedIds;

    if (orderedIds.length === 0) {
      return {
        items: [],
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    }

    if (input.sessionId || input.searchContext || input.userId) {
      const recentProductIds = input.searchContext?.recentProductIds ?? [];
      const recentMeta =
        recentProductIds.length > 0
          ? await this.searchRepository.fetchProductPersonalizationMeta(recentProductIds)
          : [];
      const profile = await this.personalizationService.buildProfile(
        input.userId,
        input.searchContext,
        recentMeta,
      );
      const metaRows = await this.searchRepository.fetchProductPersonalizationMeta(orderedIds);
      const productsById = new Map(metaRows.map((row) => [row.id, row]));
      orderedIds = this.personalizationService.reorderIds(
        orderedIds,
        scoreById,
        productsById,
        profile,
        input.weights.personalizationCap,
      );
    }

    const pageIds = orderedIds.slice(input.skip, input.skip + input.limit);

    if (pageIds.length === 0) {
      return {
        items: [],
        pagination: {
          page: input.page,
          limit: input.limit,
          total,
          totalPages: Math.ceil(total / input.limit),
        },
      };
    }

    const items = await this.hydrateProducts(pageIds);

    if (input.userId) {
      void this.personalizationService.persistUserContext(input.userId, input.searchContext);
    }

    return {
      items,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  private async hydrateProducts(ids: string[]): Promise<Product[]> {
    return this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.store', 'store')
      .leftJoinAndSelect('product.images', 'images')
      .leftJoinAndSelect('product.variants', 'variants')
      .leftJoinAndSelect('product.categoryRelation', 'categoryRelation')
      .leftJoinAndSelect('product.petTypeRelation', 'petTypeRelation')
      .leftJoinAndSelect('product.brandRelation', 'brandRelation')
      .leftJoinAndSelect('product.taxonomyTags', 'taxonomyTags')
      .where('product.id IN (:...ids)', { ids })
      .orderBy('array_position(ARRAY[:...ids]::uuid[], product.id)')
      .getMany();
  }

  private async buildSearchMatch(
    search: string,
    expandedQuery: string,
    filters: ProductQueryDto,
    weights: SearchRankingWeights,
  ): Promise<SearchMatchOptions> {
    const ftsCount = await this.searchRepository.countFtsMatches(filters, expandedQuery);

    return {
      expandedQuery,
      includeTrigram:
        shouldForceTrigramFallback(search) || ftsCount < weights.trigramFallbackThreshold,
      minSimilarity: resolveTrigramMinSimilarity(weights.trigramMinSimilarity, search),
    };
  }

  private rankingEngineShouldUseRrf(sortBy: string, search?: string): boolean {
    if (!search?.trim()) {
      return false;
    }
    return sortBy === 'relevance';
  }
}
