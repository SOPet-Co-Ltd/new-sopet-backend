import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { OrderItem } from '../../database/entities/order-item.entity';
import { ProductImage } from '../../database/entities/product-image.entity';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { OrderStatus } from '../../database/entities/enums/order.enums';
import { ProductQueryDto } from '../products/dto/product-query.dto';
import { RankingEngine } from './ranking.engine';
import type {
  SearchProductSuggestion,
  SearchQuerySuggestion,
  SearchRankingWeights,
  SearchMatchOptions,
} from './search.types';
import { VectorSearchSupport } from './vector-search.support';
import {
  resolveSuggestionMinSimilarity,
  trigramMatchExpression,
  trigramScoreExpression,
} from './trigram-match.util';

const DEFAULT_LEG_LIMIT = 100;

export type SmartSearchFilters = Pick<
  ProductQueryDto,
  | 'search'
  | 'storeId'
  | 'category'
  | 'categoryId'
  | 'tag'
  | 'tagId'
  | 'tagName'
  | 'status'
  | 'allStatuses'
  | 'petTypeIds'
  | 'brandIds'
  | 'minPrice'
  | 'maxPrice'
>;

/** Shared tag predicate — lexical, legacy, and semantic legs (post resolveApprovedTagFilter). */
function tagFilterSql(alias: string): string {
  return `(:tagName = ANY(${alias}.tags) OR EXISTS (
    SELECT 1 FROM "product_tags" "pt"
    INNER JOIN "tags" "t" ON "t"."id" = "pt"."tag_id"
    WHERE "pt"."product_id" = ${alias}.id
      AND "t"."id" = :tagId
  ))`;
}

function tagFilterSqlRaw(alias: string, tagNameParam: string, tagIdParam: string): string {
  return `(${tagNameParam} = ANY(${alias}.tags) OR EXISTS (
    SELECT 1 FROM product_tags pt
    INNER JOIN tags t ON t.id = pt.tag_id
    WHERE pt.product_id = ${alias}.id
      AND t.id = ${tagIdParam}::uuid
  ))`;
}

@Injectable()
export class SearchRepository {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly rankingEngine: RankingEngine,
    private readonly vectorSearchSupport: VectorSearchSupport,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  createPublicListingQuery(alias = 'product'): SelectQueryBuilder<Product> {
    return this.productRepository
      .createQueryBuilder(alias)
      .innerJoin(`${alias}.store`, 'store')
      .andWhere(`${alias}.deleted_at IS NULL`)
      .andWhere('store.status = :approvedStoreStatus', { approvedStoreStatus: 'approved' });
  }

  async countFtsMatches(filters: SmartSearchFilters, expandedQuery: string): Promise<number> {
    const queryBuilder = this.createPublicListingQuery();
    this.applyListingFilters(queryBuilder, filters, 'product', {
      expandedQuery,
      includeTrigram: false,
      minSimilarity: 0,
    });

    const row = await queryBuilder.select('COUNT(product.id)', 'cnt').getRawOne<{ cnt: string }>();
    return Number(row?.cnt ?? 0);
  }

  async fetchFtsLegIds(
    filters: SmartSearchFilters,
    expandedQuery: string,
    limit = DEFAULT_LEG_LIMIT,
  ): Promise<string[]> {
    const queryBuilder = this.createPublicListingQuery('product')
      .select('product.id', 'id')
      .andWhere(
        `product.search_vector @@ plainto_tsquery(sopet_search_ts_config(), :smartFtsQuery)`,
        { smartFtsQuery: expandedQuery },
      )
      .addSelect(
        `ts_rank(product.search_vector, plainto_tsquery(sopet_search_ts_config(), :smartFtsRankQuery))`,
        'fts_rank',
      )
      .setParameter('smartFtsRankQuery', expandedQuery);

    this.applyNonSearchListingFilters(queryBuilder, filters, 'product');
    queryBuilder.orderBy('fts_rank', 'DESC').addOrderBy('product.id', 'ASC').limit(limit);

    const rows = await queryBuilder.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async fetchTrigramLegIds(
    filters: SmartSearchFilters,
    expandedQuery: string,
    minSimilarity: number,
    limit = DEFAULT_LEG_LIMIT,
  ): Promise<string[]> {
    const queryBuilder = this.createPublicListingQuery('product')
      .select('product.id', 'id')
      .addSelect(trigramScoreExpression('product.name', ':smartTrigramQuery'), 'trigram_rank')
      .andWhere(
        trigramMatchExpression('product.name', ':smartTrigramQuery', ':smartMinSimilarity'),
        {
          smartTrigramQuery: expandedQuery,
          smartMinSimilarity: minSimilarity,
        },
      );

    this.applyNonSearchListingFilters(queryBuilder, filters, 'product');
    queryBuilder.orderBy('trigram_rank', 'DESC').addOrderBy('product.id', 'ASC').limit(limit);

    const rows = await queryBuilder.getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async fetchSemanticLegIds(
    filters: SmartSearchFilters,
    queryEmbedding: number[],
    limit = DEFAULT_LEG_LIMIT,
  ): Promise<string[]> {
    if (!(await this.vectorSearchSupport.isAvailable())) {
      return [];
    }

    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const conditions: string[] = [
      'product.deleted_at IS NULL',
      "store.status = 'approved'",
      "product.status = 'published'",
      'pe.embedding IS NOT NULL',
    ];
    const params: unknown[] = [vectorLiteral, limit];
    let paramIndex = 3;

    if (filters.storeId) {
      conditions.push(`product.store_id = $${paramIndex++}`);
      params.push(filters.storeId);
    }
    if (filters.categoryId) {
      conditions.push(`product.category_id = $${paramIndex++}::uuid`);
      params.push(filters.categoryId);
    }
    if (filters.tagId && filters.tagName) {
      conditions.push(tagFilterSqlRaw('product', `$${paramIndex++}`, `$${paramIndex++}`));
      params.push(filters.tagName, filters.tagId);
    }
    if (filters.petTypeIds && filters.petTypeIds.length > 0) {
      conditions.push(`product.pet_type_id = ANY($${paramIndex++}::uuid[])`);
      params.push(filters.petTypeIds);
    }
    if (filters.brandIds && filters.brandIds.length > 0) {
      conditions.push(`product.brand_id = ANY($${paramIndex++}::uuid[])`);
      params.push(filters.brandIds);
    }
    if (filters.minPrice !== undefined) {
      conditions.push(`product.base_price >= $${paramIndex++}`);
      params.push(filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      conditions.push(`product.base_price <= $${paramIndex++}`);
      params.push(filters.maxPrice);
    }

    const rows: Array<{ id: string }> = await this.dataSource.query(
      `
      SELECT product.id AS id
      FROM products product
      INNER JOIN stores store ON store.id = product.store_id
      INNER JOIN product_embeddings pe ON pe.product_id = product.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY pe.embedding <=> $1::vector ASC, product.id ASC
      LIMIT $2
    `,
      params,
    );

    return rows.map((row) => row.id);
  }

  async fetchProductPersonalizationMeta(productIds: string[]): Promise<
    Array<{
      id: string;
      petTypeId: string | null;
      brandId: string | null;
      categoryId: string | null;
      category: string | null;
      name: string;
    }>
  > {
    if (productIds.length === 0) {
      return [];
    }

    return this.productRepository
      .createQueryBuilder('product')
      .select('product.id', 'id')
      .addSelect('product.petTypeId', 'petTypeId')
      .addSelect('product.brandId', 'brandId')
      .addSelect('product.categoryId', 'categoryId')
      .addSelect('product.category', 'category')
      .addSelect('product.name', 'name')
      .where('product.id IN (:...productIds)', { productIds })
      .getRawMany();
  }

  private applyNonSearchListingFilters(
    queryBuilder: SelectQueryBuilder<Product>,
    filters: SmartSearchFilters,
    alias = 'product',
  ): void {
    const {
      storeId,
      categoryId,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    } = filters;

    if (storeId) {
      queryBuilder.andWhere(`${alias}.storeId = :storeId`, { storeId });
    }
    if (categoryId) {
      queryBuilder.andWhere(`${alias}.categoryId = :categoryId`, { categoryId });
    }
    if (tagId && tagName) {
      queryBuilder.andWhere(tagFilterSql(alias), { tagId, tagName });
    }
    if (status) {
      queryBuilder.andWhere(`${alias}.status = :status`, { status });
    } else if (!allStatuses) {
      queryBuilder.andWhere(`${alias}.status = :status`, {
        status: ProductStatus.PUBLISHED,
      });
    }
    if (petTypeIds && petTypeIds.length > 0) {
      queryBuilder.andWhere(`${alias}.petTypeId IN (:...petTypeIds)`, { petTypeIds });
    }
    if (brandIds && brandIds.length > 0) {
      queryBuilder.andWhere(`${alias}.brandId IN (:...brandIds)`, { brandIds });
    }
    if (minPrice !== undefined) {
      queryBuilder.andWhere(`${alias}.basePrice >= :minPrice`, { minPrice });
    }
    if (maxPrice !== undefined) {
      queryBuilder.andWhere(`${alias}.basePrice <= :maxPrice`, { maxPrice });
    }
  }

  applyListingFilters(
    queryBuilder: SelectQueryBuilder<Product>,
    filters: SmartSearchFilters,
    alias = 'product',
    searchMatch?: SearchMatchOptions,
  ): void {
    const {
      search,
      storeId,
      categoryId,
      tagId,
      tagName,
      status,
      allStatuses,
      petTypeIds,
      brandIds,
      minPrice,
      maxPrice,
    } = filters;

    if (search?.trim() && searchMatch) {
      const ftsClause = `${alias}.search_vector @@ plainto_tsquery(sopet_search_ts_config(), :smartSearchQuery)`;
      queryBuilder.setParameter('smartSearchQuery', searchMatch.expandedQuery);

      if (searchMatch.includeTrigram) {
        queryBuilder
          .andWhere(
            `(${ftsClause} OR ${trigramMatchExpression(`${alias}.name`, ':smartTrigramQuery', ':smartMinSimilarity')})`,
          )
          .setParameter('smartTrigramQuery', searchMatch.expandedQuery)
          .setParameter('smartMinSimilarity', searchMatch.minSimilarity);
      } else {
        queryBuilder.andWhere(ftsClause);
      }
    } else if (search?.trim()) {
      queryBuilder.andWhere(
        `${alias}.search_vector @@ plainto_tsquery(sopet_search_ts_config(), :smartSearchQuery)`,
        { smartSearchQuery: search.trim() },
      );
    }

    if (storeId) {
      queryBuilder.andWhere(`${alias}.storeId = :storeId`, { storeId });
    }

    if (categoryId) {
      queryBuilder.andWhere(`${alias}.categoryId = :categoryId`, { categoryId });
    }

    if (tagId && tagName) {
      queryBuilder.andWhere(tagFilterSql(alias), { tagId, tagName });
    }

    if (status) {
      queryBuilder.andWhere(`${alias}.status = :status`, { status });
    } else if (!allStatuses) {
      queryBuilder.andWhere(`${alias}.status = :status`, {
        status: ProductStatus.PUBLISHED,
      });
    }

    if (petTypeIds && petTypeIds.length > 0) {
      queryBuilder.andWhere(`${alias}.petTypeId IN (:...petTypeIds)`, { petTypeIds });
    }

    if (brandIds && brandIds.length > 0) {
      queryBuilder.andWhere(`${alias}.brandId IN (:...brandIds)`, { brandIds });
    }

    if (minPrice !== undefined) {
      queryBuilder.andWhere(`${alias}.basePrice >= :minPrice`, { minPrice });
    }

    if (maxPrice !== undefined) {
      queryBuilder.andWhere(`${alias}.basePrice <= :maxPrice`, { maxPrice });
    }
  }

  applySorting(
    queryBuilder: SelectQueryBuilder<Product>,
    sortBy: string,
    sortOrder: 'ASC' | 'DESC',
    search: string | undefined,
    weights: SearchRankingWeights,
    alias = 'product',
    searchMatch?: SearchMatchOptions,
  ): void {
    const excludedStatuses = [OrderStatus.CANCELLED, OrderStatus.REFUNDED];

    if (sortBy === 'soldCount') {
      queryBuilder
        .addSelect((subQuery) => {
          return subQuery
            .select('COALESCE(SUM(oi.quantity), 0)', 'sold_count')
            .from(OrderItem, 'oi')
            .innerJoin('oi.order', 'o')
            .innerJoin('oi.productVariant', 'salesVariant')
            .where(`salesVariant.productId = ${alias}.id`)
            .andWhere('o.status NOT IN (:...excludedStatuses)', { excludedStatuses });
        }, 'sold_count_sort')
        .orderBy('sold_count_sort', sortOrder);
      return;
    }

    if (this.rankingEngine.shouldUseCompositeRelevance(sortBy, search) && search?.trim()) {
      const rankQuery = searchMatch?.expandedQuery ?? search.trim();
      const trigramBoost =
        searchMatch?.includeTrigram && searchMatch.expandedQuery
          ? ` + (GREATEST(${trigramScoreExpression(`${alias}.name`, ':smartTrigramRankQuery')}, 0) * ${weights.text})`
          : '';

      queryBuilder
        .addSelect(
          `(
            ts_rank(${alias}.search_vector, plainto_tsquery(sopet_search_ts_config(), :smartRankQuery)) * ${weights.text}
            + (CASE WHEN ${alias}.name ILIKE :smartRankPrefix THEN ${weights.prefixBoost} ELSE 0 END)
            + (LEAST(COALESCE(${alias}.average_rating / 5.0, 0), 1) * ${weights.averageRating})
            + (LEAST(COALESCE(${alias}.review_count, 0) / 100.0, 1) * ${weights.reviewCount})
            ${trigramBoost}
          )`,
          'smart_composite_rank',
        )
        .setParameter('smartRankQuery', rankQuery)
        .setParameter('smartRankPrefix', `${search.trim()}%`);

      if (searchMatch?.includeTrigram) {
        queryBuilder.setParameter('smartTrigramRankQuery', searchMatch.expandedQuery);
      }

      queryBuilder.orderBy('smart_composite_rank', 'DESC').addOrderBy(`${alias}.id`, 'ASC');
      return;
    }

    const allowedColumns: Record<string, string> = {
      createdAt: 'createdAt',
      basePrice: 'basePrice',
      averageRating: 'averageRating',
      name: 'name',
    };

    const column = allowedColumns[sortBy] ?? 'createdAt';
    queryBuilder
      .addSelect(`${alias}.${column}`, `product_${column}`)
      .orderBy(`${alias}.${column}`, sortOrder);
  }

  async suggestProducts(query: string, limit: number): Promise<SearchProductSuggestion[]> {
    const minSimilarity = resolveSuggestionMinSimilarity(query);

    const rows = await this.createPublicListingQuery('product')
      .select('product.id', 'id')
      .addSelect('product.name', 'name')
      .addSelect('product.slug', 'slug')
      .addSelect((subQuery) => {
        return subQuery
          .select('img.url')
          .from(ProductImage, 'img')
          .where('img.productId = product.id')
          .orderBy('img.isThumbnail', 'DESC')
          .addOrderBy('img.sortOrder', 'ASC')
          .addOrderBy('img.createdAt', 'ASC')
          .limit(1);
      }, 'thumbnail_url')
      .addSelect(trigramScoreExpression('product.name', ':suggestQuery'), 'sim')
      .andWhere('product.status = :publishedStatus', { publishedStatus: ProductStatus.PUBLISHED })
      .andWhere(
        `(product.name ILIKE :suggestPrefix OR ${trigramMatchExpression('product.name', ':suggestQuery', ':suggestMinSimilarity')})`,
        {
          suggestQuery: query,
          suggestPrefix: `${query}%`,
          suggestMinSimilarity: minSimilarity,
        },
      )
      .orderBy('sim', 'DESC')
      .addOrderBy('product.name', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string; name: string; slug: string; thumbnail_url: string | null }>();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      thumbnailUrl: row.thumbnail_url ?? null,
    }));
  }

  async suggestQueries(query: string, limit: number): Promise<SearchQuerySuggestion[]> {
    const minSimilarity = resolveSuggestionMinSimilarity(query);

    const rows = await this.createPublicListingQuery('product')
      .select('DISTINCT product.name', 'name')
      .addSelect(trigramScoreExpression('product.name', ':suggestQuery'), 'sim')
      .andWhere('product.status = :publishedStatus', { publishedStatus: ProductStatus.PUBLISHED })
      .andWhere(
        `(product.name ILIKE :suggestPrefix OR ${trigramMatchExpression('product.name', ':suggestQuery', ':suggestMinSimilarity')})`,
        {
          suggestQuery: query,
          suggestPrefix: `${query}%`,
          suggestMinSimilarity: minSimilarity,
        },
      )
      .orderBy('sim', 'DESC')
      .addOrderBy('product.name', 'ASC')
      .limit(limit)
      .getRawMany<{ name: string }>();

    return rows
      .map((row) => ({ query: row.name }))
      .filter((item) => item.query.toLowerCase() !== query.toLowerCase());
  }

  async suggestFuzzyQueries(query: string, limit: number): Promise<string[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return [];
    }

    const minSimilarity = resolveSuggestionMinSimilarity(trimmed);
    const rows = await this.createPublicListingQuery('product')
      .select('DISTINCT product.name', 'name')
      .addSelect(trigramScoreExpression('product.name', ':suggestQuery'), 'sim')
      .andWhere('product.status = :publishedStatus', { publishedStatus: ProductStatus.PUBLISHED })
      .andWhere(trigramMatchExpression('product.name', ':suggestQuery', ':suggestMinSimilarity'), {
        suggestQuery: trimmed,
        suggestMinSimilarity: minSimilarity,
      })
      .orderBy('sim', 'DESC')
      .addOrderBy('product.name', 'ASC')
      .limit(limit)
      .getRawMany<{ name: string }>();

    return rows.map((row) => row.name);
  }
}
