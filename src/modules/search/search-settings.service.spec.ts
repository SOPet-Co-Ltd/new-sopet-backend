import { SearchSettingsService } from './search-settings.service';
import { DEFAULT_SEARCH_RANKING_WEIGHTS } from './search.types';
import type { Setting } from '../../database/entities/setting.entity';
import type { Repository } from 'typeorm';

describe('SearchSettingsService', () => {
  const createService = ({
    row,
    cached,
  }: {
    row?: Partial<Setting> | null;
    cached?: string | null;
  } = {}) => {
    const save = jest.fn(async (value: unknown) => value);
    const set = jest.fn(async () => undefined);
    const settingsRepository = {
      findOne: jest.fn(async () => row ?? null),
      create: jest.fn((value) => value),
      save,
    } as unknown as Repository<Setting>;

    const redisService = {
      get: jest.fn(async () => cached ?? null),
      set,
    };

    return {
      service: new SearchSettingsService(settingsRepository, redisService as never),
      save,
      set,
    };
  };

  it('returns default weights when settings row is missing', async () => {
    const { service } = createService();
    const weights = await service.getRankingWeights();

    expect(weights).toEqual(DEFAULT_SEARCH_RANKING_WEIGHTS);
  });

  it('merges partial persisted weights with defaults', async () => {
    const { service } = createService({
      row: {
        key: 'search.ranking_weights',
        value: { text: 55 },
      },
    });

    const weights = await service.getRankingWeights();
    expect(weights.text).toBe(55);
    expect(weights.prefixBoost).toBe(DEFAULT_SEARCH_RANKING_WEIGHTS.prefixBoost);
  });

  it('rejects invalid personalizationCap values', () => {
    const { service } = createService();

    expect(() => service.assertValidWeights({ personalizationCap: -0.1 })).toThrow(
      'personalizationCap must be between 0 and 0.20',
    );
    expect(() => service.assertValidWeights({ personalizationCap: 0.5 })).toThrow(
      'personalizationCap must be between 0 and 0.20',
    );
  });

  it('persists merged weights on update', async () => {
    const { service, save, set } = createService();
    const updated = await service.updateRankingWeights({ text: 50 });

    expect(updated.text).toBe(50);
    expect(save).toHaveBeenCalled();
    expect(set).toHaveBeenCalled();
  });
});
