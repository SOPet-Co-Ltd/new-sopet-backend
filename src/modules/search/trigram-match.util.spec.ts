import {
  lexicalNameMatchExpression,
  nameContainsExpression,
  queryGraphemeLength,
  resolveSuggestionMinSimilarity,
  resolveTrigramMinSimilarity,
  shouldForceTrigramFallback,
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

  it('counts Thai graphemes for length thresholds', () => {
    expect(queryGraphemeLength('หม่')).toBe(3);
    expect(resolveSuggestionMinSimilarity('prt')).toBe(0.12);
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
