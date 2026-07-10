import { RankingEngine } from './ranking.engine';
import { DEFAULT_SEARCH_RANKING_WEIGHTS } from './search.types';

describe('RankingEngine', () => {
  const engine = new RankingEngine();
  const weights = DEFAULT_SEARCH_RANKING_WEIGHTS;

  it('combines text, prefix boost, and normalized business signals', () => {
    const score = engine.computeCompositeScore(
      {
        tsRank: 0.5,
        namePrefixMatch: true,
        soldCount: 50,
        averageRating: 4,
        reviewCount: 25,
        maxSoldCount: 100,
        maxReviewCount: 50,
      },
      weights,
    );

    expect(score).toBeGreaterThan(0);
    expect(score).toBeCloseTo(
      (0.5 * weights.text +
        weights.prefixBoost +
        0.5 * weights.soldCount +
        0.8 * weights.averageRating +
        0.5 * weights.reviewCount) *
        1,
      5,
    );
  });

  it('caps personalization boost at personalizationCap', () => {
    const withoutBoost = engine.computeCompositeScore(
      {
        tsRank: 0.2,
        namePrefixMatch: false,
        soldCount: 0,
        averageRating: 0,
        reviewCount: 0,
        maxSoldCount: 0,
        maxReviewCount: 0,
        personalizationBoost: 0,
      },
      weights,
    );

    const withBoost = engine.computeCompositeScore(
      {
        tsRank: 0.2,
        namePrefixMatch: false,
        soldCount: 0,
        averageRating: 0,
        reviewCount: 0,
        maxSoldCount: 0,
        maxReviewCount: 0,
        personalizationBoost: 1,
      },
      weights,
    );

    expect(withBoost).toBeCloseTo(withoutBoost * (1 + weights.personalizationCap), 5);
  });

  it('uses composite relevance only when sortBy is relevance and search is non-empty', () => {
    expect(engine.shouldUseCompositeRelevance('relevance', 'cat food')).toBe(true);
    expect(engine.shouldUseCompositeRelevance(undefined, 'cat food')).toBe(true);
    expect(engine.shouldUseCompositeRelevance('soldCount', 'cat food')).toBe(false);
    expect(engine.shouldUseCompositeRelevance('relevance', '   ')).toBe(false);
    expect(engine.shouldUseCompositeRelevance('relevance')).toBe(false);
  });
});
