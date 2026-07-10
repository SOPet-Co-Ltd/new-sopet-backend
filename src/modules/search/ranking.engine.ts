import { Injectable } from '@nestjs/common';
import type { SearchRankingWeights } from './search.types';

export type RankingScoreInput = {
  tsRank: number;
  namePrefixMatch: boolean;
  soldCount: number;
  averageRating: number;
  reviewCount: number;
  maxSoldCount: number;
  maxReviewCount: number;
  personalizationBoost?: number;
};

@Injectable()
export class RankingEngine {
  computeCompositeScore(input: RankingScoreInput, weights: SearchRankingWeights): number {
    const textScore =
      input.tsRank * weights.text + (input.namePrefixMatch ? weights.prefixBoost : 0);

    const soldNorm = input.maxSoldCount > 0 ? input.soldCount / input.maxSoldCount : 0;
    const ratingNorm = Math.min(Math.max(input.averageRating / 5, 0), 1);
    const reviewNorm = input.maxReviewCount > 0 ? input.reviewCount / input.maxReviewCount : 0;

    const businessScore =
      soldNorm * weights.soldCount +
      ratingNorm * weights.averageRating +
      reviewNorm * weights.reviewCount;

    const base = textScore + businessScore;
    const boost = Math.min(
      Math.max(input.personalizationBoost ?? 0, 0),
      weights.personalizationCap,
    );

    return base * (1 + boost);
  }

  shouldUseCompositeRelevance(sortBy?: string, search?: string): boolean {
    if (!search?.trim()) {
      return false;
    }

    const normalized = sortBy ?? 'relevance';
    return normalized === 'relevance';
  }
}
