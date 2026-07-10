import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../database/entities/setting.entity';
import { RedisService } from '../redis/redis.service';
import { DEFAULT_SEARCH_RANKING_WEIGHTS, SearchRankingWeights } from './search.types';

const SETTINGS_KEY = 'search.ranking_weights';
const CACHE_KEY = 'search:ranking_weights';
const CACHE_TTL_SECONDS = 60;

@Injectable()
export class SearchSettingsService {
  constructor(
    @InjectRepository(Setting)
    private readonly settingsRepository: Repository<Setting>,
    private readonly redisService: RedisService,
  ) {}

  async getRankingWeights(): Promise<SearchRankingWeights> {
    const cached = await this.redisService.get(CACHE_KEY);
    if (cached) {
      return this.mergeWithDefaults(JSON.parse(cached));
    }

    const row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    const weights = this.mergeWithDefaults(row?.value ?? DEFAULT_SEARCH_RANKING_WEIGHTS);

    await this.redisService.set(CACHE_KEY, JSON.stringify(weights), CACHE_TTL_SECONDS);
    return weights;
  }

  async updateRankingWeights(
    weights: Partial<SearchRankingWeights>,
  ): Promise<SearchRankingWeights> {
    this.assertValidWeights(weights);

    const merged = this.mergeWithDefaults({
      ...(await this.getRankingWeights()),
      ...weights,
    });

    let row = await this.settingsRepository.findOne({ where: { key: SETTINGS_KEY } });
    if (row) {
      row.value = merged;
    } else {
      row = this.settingsRepository.create({
        key: SETTINGS_KEY,
        value: merged,
        description: 'Smart Search ranking weight configuration',
      });
    }

    await this.settingsRepository.save(row);
    await this.redisService.set(CACHE_KEY, JSON.stringify(merged), CACHE_TTL_SECONDS);
    return merged;
  }

  assertValidWeights(weights: Partial<SearchRankingWeights>): void {
    const numericFields: (keyof SearchRankingWeights)[] = [
      'text',
      'prefixBoost',
      'soldCount',
      'averageRating',
      'reviewCount',
      'personalizationCap',
      'trigramFallbackThreshold',
      'trigramMinSimilarity',
      'rrfK',
    ];

    for (const field of numericFields) {
      const value = weights[field];
      if (value === undefined) {
        continue;
      }

      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`Invalid weight for ${field}`);
      }

      if (field === 'personalizationCap') {
        if (value < 0 || value > 0.2) {
          throw new Error('personalizationCap must be between 0 and 0.20');
        }
        continue;
      }

      if (value < 0) {
        throw new Error(`Weight ${field} must be non-negative`);
      }
    }
  }

  private mergeWithDefaults(value: unknown): SearchRankingWeights {
    const partial = (value ?? {}) as Partial<SearchRankingWeights>;
    return {
      ...DEFAULT_SEARCH_RANKING_WEIGHTS,
      ...partial,
    };
  }
}
