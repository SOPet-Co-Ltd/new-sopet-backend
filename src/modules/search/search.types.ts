export type SearchRankingWeights = {
  text: number;
  prefixBoost: number;
  soldCount: number;
  averageRating: number;
  reviewCount: number;
  personalizationCap: number;
  trigramFallbackThreshold: number;
  trigramMinSimilarity: number;
  rrfK: number;
};

export const DEFAULT_SEARCH_RANKING_WEIGHTS: SearchRankingWeights = {
  text: 40,
  prefixBoost: 15,
  soldCount: 20,
  averageRating: 15,
  reviewCount: 10,
  personalizationCap: 0.1,
  trigramFallbackThreshold: 5,
  trigramMinSimilarity: 0.3,
  rrfK: 60,
};

export type SearchContextPayload = {
  recentQueries?: string[];
  recentProductIds?: string[];
};

export type SearchProductSuggestion = {
  id: string;
  name: string;
  slug: string;
  thumbnailUrl?: string | null;
};

export type SearchQuerySuggestion = {
  query: string;
};

export type SearchSuggestionsPayload = {
  products: SearchProductSuggestion[];
  queries: SearchQuerySuggestion[];
};

export type SearchMatchOptions = {
  expandedQuery: string;
  includeTrigram: boolean;
  minSimilarity: number;
};
