/** Queries at or below this length always get trigram fallback (typo-prone). */
export const SHORT_QUERY_MAX_LENGTH = 5;

const SUGGESTION_BASE_MIN_SIMILARITY = 0.2;

/** Thai letters / digits — used to split unspaced product-name spans. */
const THAI_SPAN_SPLIT_REGEX = '[^ก-๙]+';

export function queryGraphemeLength(query: string): number {
  return [...query.trim()].length;
}

/**
 * Unspaced Thai (no Latin/digit tokens, no whitespace) — pg_trgm word_similarity
 * will not split the name, so the trigram leg must always run.
 */
export function isUnspacedThaiQuery(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }

  const hasThai = /[ก-๙]/.test(trimmed);
  const hasLatinOrSpace = /[A-Za-z0-9\s]/.test(trimmed);
  return hasThai && !hasLatinOrSpace;
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
  return queryGraphemeLength(query) <= SHORT_QUERY_MAX_LENGTH || isUnspacedThaiQuery(query);
}

/**
 * Best trigram score: full-string, word-level, and per Thai-script span.
 * Thai span scoring catches typos like อาหาแมว → อาหารแมว inside longer names
 * where word_similarity does not split unspaced Thai.
 */
export function trigramScoreExpression(nameColumn: string, queryParam: string): string {
  return `GREATEST(
    similarity(${nameColumn}, ${queryParam}),
    word_similarity(${queryParam}, ${nameColumn}),
    COALESCE((
      SELECT MAX(similarity(span, ${queryParam}))
      FROM regexp_split_to_table(${nameColumn}, '${THAI_SPAN_SPLIT_REGEX}') AS span
      WHERE span <> ''
    ), 0)
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
