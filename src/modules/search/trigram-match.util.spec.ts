import {
  isUnspacedThaiQuery,
  lexicalNameMatchExpression,
  nameContainsExpression,
  queryGraphemeLength,
  resolveSuggestionMinSimilarity,
  resolveTrigramMinSimilarity,
  shouldForceTrigramFallback,
  trigramScoreExpression,
} from './trigram-match.util';

describe('trigram-match.util', () => {
  it('lowers similarity floor for short typo-prone queries', () => {
    expect(resolveTrigramMinSimilarity(0.3, 'prt')).toBe(0.12);
    expect(resolveTrigramMinSimilarity(0.3, 'หม่')).toBe(0.12);
    expect(resolveTrigramMinSimilarity(0.3, 'royal')).toBe(0.18);
    expect(resolveTrigramMinSimilarity(0.3, 'royal canin')).toBe(0.3);
  });

  it('forces trigram fallback for short queries', () => {
    expect(shouldForceTrigramFallback('prt')).toBe(true);
    expect(shouldForceTrigramFallback('หม่')).toBe(true);
    expect(shouldForceTrigramFallback('royal canin')).toBe(false);
  });

  it('forces trigram fallback for unspaced Thai typo queries', () => {
    expect(isUnspacedThaiQuery('อาหาแมว')).toBe(true);
    expect(isUnspacedThaiQuery('อาหารแมว')).toBe(true);
    expect(isUnspacedThaiQuery('royal อาหาร')).toBe(false);
    expect(shouldForceTrigramFallback('อาหาแมว')).toBe(true);
  });

  it('counts Thai graphemes for length thresholds', () => {
    expect(queryGraphemeLength('หม่')).toBe(3);
    expect(queryGraphemeLength('อาหาแมว')).toBe(7);
    expect(resolveSuggestionMinSimilarity('prt')).toBe(0.12);
  });

  it('scores Thai script spans in addition to similarity / word_similarity', () => {
    const expression = trigramScoreExpression('product.name', ':smartTrigramQuery');
    expect(expression).toContain('word_similarity(:smartTrigramQuery, product.name)');
    expect(expression).toContain("regexp_split_to_table(product.name, '[^ก-๙]+')");
    expect(expression).toContain('MAX(similarity(span, :smartTrigramQuery))');
  });

  it('builds bilingual lexical name match with substring contains', () => {
    expect(nameContainsExpression('product.name', ':suggestContains')).toBe(
      'product.name ILIKE :suggestContains',
    );
    expect(
      lexicalNameMatchExpression('product.name', {
        containsParam: ':suggestContains',
        prefixParam: ':suggestPrefix',
        queryParam: ':suggestQuery',
        minSimilarityParam: ':suggestMinSimilarity',
      }),
    ).toContain('product.name ILIKE :suggestContains');
  });
});
