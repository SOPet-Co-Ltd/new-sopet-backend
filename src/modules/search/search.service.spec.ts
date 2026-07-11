import { ConfigService } from '@nestjs/config';
import { SearchService } from './search.service';
import type { SearchRepository } from './search.repository';
import type { SearchSettingsService } from './search-settings.service';
import type { Repository } from 'typeorm';
import type { Product } from '../../database/entities/product.entity';

describe('SearchService', () => {
  const createService = (smartEnabled: string | undefined) => {
    const configService = {
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'search.smartEnabled') {
          return smartEnabled === 'true';
        }
        return defaultValue;
      }),
    } as unknown as ConfigService;

    return new SearchService(
      configService,
      {} as SearchRepository,
      {} as SearchSettingsService,
      {} as import('./search-synonym.service').SearchSynonymService,
      { isConfigured: () => false, embedText: jest.fn() } as never,
      { merge: jest.fn(), scoreMap: jest.fn() },
      {
        buildProfile: jest.fn(),
        reorderIds: jest.fn(),
        persistUserContext: jest.fn(),
      } as never,
      {} as Repository<Product>,
    );
  };

  it('returns false when SEARCH_SMART_ENABLED is unset', () => {
    const service = createService(undefined);
    expect(service.isSmartSearchEnabled()).toBe(false);
  });

  it('returns false when SEARCH_SMART_ENABLED is false', () => {
    const service = createService('false');
    expect(service.isSmartSearchEnabled()).toBe(false);
  });

  it('returns true when SEARCH_SMART_ENABLED is true', () => {
    const service = createService('true');
    expect(service.isSmartSearchEnabled()).toBe(true);
  });
});
