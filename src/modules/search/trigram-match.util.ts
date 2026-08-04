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

/**
 * Exact substring match for product names.
 * Needed for Thai (and mixed Thai/English) names when FTS uses the `simple`
 * config — unspaced Thai is one lexeme, so substring FTS/trigram alone can miss.
 */
export function nameContainsExpression(nameColumn: string, containsParam: string): string {
  return `${nameColumn} ILIKE ${containsParam}`;
}

/** Prefix / contains / trigram — bilingual lexical suggestion match. */
export function lexicalNameMatchExpression(
  nameColumn: string,
  options: {
    containsParam: string;
    prefixParam: string;
    queryParam: string;
    minSimilarityParam: string;
  },
): string {
  return `(${nameContainsExpression(nameColumn, options.containsParam)}
    OR ${nameColumn} ILIKE ${options.prefixParam}
    OR ${trigramMatchExpression(nameColumn, options.queryParam, options.minSimilarityParam)})`;
}
