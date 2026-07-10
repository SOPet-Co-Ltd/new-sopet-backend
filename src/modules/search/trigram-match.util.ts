/** Queries at or below this length always get trigram fallback (typo-prone). */
export const SHORT_QUERY_MAX_LENGTH = 5;

const SUGGESTION_BASE_MIN_SIMILARITY = 0.2;

export function queryGraphemeLength(query: string): number {
  return [...query.trim()].length;
}

export function resolveTrigramMinSimilarity(baseMinSimilarity: number, query: string): number {
  const length = queryGraphemeLength(query);

  if (length <= 3) {
    return Math.min(baseMinSimilarity, 0.12);
  }

  if (length <= SHORT_QUERY_MAX_LENGTH) {
    return Math.min(baseMinSimilarity, 0.18);
  }

  return baseMinSimilarity;
}

export function resolveSuggestionMinSimilarity(query: string): number {
  return resolveTrigramMinSimilarity(SUGGESTION_BASE_MIN_SIMILARITY, query);
}

export function shouldForceTrigramFallback(query: string): boolean {
  return queryGraphemeLength(query) <= SHORT_QUERY_MAX_LENGTH;
}

/** Best trigram score between full-string and word-level fuzzy match. */
export function trigramScoreExpression(nameColumn: string, queryParam: string): string {
  return `GREATEST(
    similarity(${nameColumn}, ${queryParam}),
    word_similarity(${queryParam}, ${nameColumn})
  )`;
}

export function trigramMatchExpression(
  nameColumn: string,
  queryParam: string,
  minSimilarityParam: string,
): string {
  return `${trigramScoreExpression(nameColumn, queryParam)} >= ${minSimilarityParam}`;
}
