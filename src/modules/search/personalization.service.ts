import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSearchProfile } from '../../database/entities/user-search-profile.entity';
import type { SearchContextPayload } from './search.types';

export type PersonalizationProfile = {
  petTypeIds: string[];
  brandIds: string[];
  categoryIds: string[];
  queryTokens: string[];
};

export type PersonalizationProductMeta = {
  id: string;
  petTypeId?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  category?: string | null;
  name?: string;
};

@Injectable()
export class PersonalizationService {
  constructor(
    @InjectRepository(UserSearchProfile)
    private readonly userSearchProfileRepository: Repository<UserSearchProfile>,
  ) {}

  async buildProfile(
    userId?: string,
    context?: SearchContextPayload,
    recentProductMeta: PersonalizationProductMeta[] = [],
  ): Promise<PersonalizationProfile> {
    const profile: PersonalizationProfile = {
      petTypeIds: [],
      brandIds: [],
      categoryIds: [],
      queryTokens: [],
    };

    const recentQueries = [...(context?.recentQueries ?? [])];
    const recentProductIds = [...(context?.recentProductIds ?? [])];

    if (userId) {
      const stored = await this.userSearchProfileRepository.findOne({ where: { userId } });
      if (stored) {
        recentQueries.push(...stored.recentQueries);
        recentProductIds.push(...stored.recentProductIds);
      }
    }

    profile.queryTokens = this.tokenizeQueries(recentQueries);

    for (const product of recentProductMeta) {
      if (product.petTypeId) {
        profile.petTypeIds.push(product.petTypeId);
      }
      if (product.brandId) {
        profile.brandIds.push(product.brandId);
      }
      if (product.categoryId) {
        profile.categoryIds.push(product.categoryId);
      }
    }

    profile.petTypeIds = [...new Set(profile.petTypeIds)];
    profile.brandIds = [...new Set(profile.brandIds)];
    profile.categoryIds = [...new Set(profile.categoryIds)];

    return profile;
  }

  computeBoost(product: PersonalizationProductMeta, profile: PersonalizationProfile): number {
    if (
      profile.petTypeIds.length === 0 &&
      profile.brandIds.length === 0 &&
      profile.categoryIds.length === 0 &&
      profile.queryTokens.length === 0
    ) {
      return 0;
    }

    let boost = 0;

    if (product.petTypeId && profile.petTypeIds.includes(product.petTypeId)) {
      boost += 0.05;
    }
    if (product.brandId && profile.brandIds.includes(product.brandId)) {
      boost += 0.05;
    }
    if (product.categoryId && profile.categoryIds.includes(product.categoryId)) {
      boost += 0.03;
    }

    const productName = product.name?.toLowerCase() ?? '';
    if (productName && profile.queryTokens.some((token) => productName.includes(token))) {
      boost += 0.02;
    }

    return boost;
  }

  reorderIds(
    ids: string[],
    scoreById: Map<string, number>,
    productsById: Map<string, PersonalizationProductMeta>,
    profile: PersonalizationProfile,
    cap: number,
  ): string[] {
    if (ids.length <= 1) {
      return ids;
    }

    return [...ids].sort((leftId, rightId) => {
      const leftBoost = Math.min(
        this.computeBoost(productsById.get(leftId) ?? { id: leftId }, profile),
        cap,
      );
      const rightBoost = Math.min(
        this.computeBoost(productsById.get(rightId) ?? { id: rightId }, profile),
        cap,
      );
      const leftScore = (scoreById.get(leftId) ?? 0) * (1 + leftBoost);
      const rightScore = (scoreById.get(rightId) ?? 0) * (1 + rightBoost);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return leftId.localeCompare(rightId);
    });
  }

  async persistUserContext(userId: string, context?: SearchContextPayload): Promise<void> {
    if (!context) {
      return;
    }

    const recentQueries = context.recentQueries?.slice(0, 10) ?? [];
    const recentProductIds = context.recentProductIds?.slice(0, 20) ?? [];

    if (recentQueries.length === 0 && recentProductIds.length === 0) {
      return;
    }

    try {
      await this.userSearchProfileRepository.save({
        userId,
        recentQueries,
        recentProductIds,
      });
    } catch {
      // Profile persistence is best-effort; auth user ids may not exist in users table yet.
    }
  }

  private tokenizeQueries(queries: string[]): string[] {
    const tokens = new Set<string>();

    for (const query of queries) {
      for (const token of query.toLowerCase().split(/\s+/)) {
        const normalized = token.trim();
        if (normalized.length >= 2) {
          tokens.add(normalized);
        }
      }
    }

    return [...tokens];
  }
}
