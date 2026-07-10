import { BadRequestException } from '@nestjs/common';
import { SearchSynonymService } from './search-synonym.service';
import type { Repository } from 'typeorm';
import type { SearchSynonym } from '../../database/entities/search-synonym.entity';

describe('SearchSynonymService', () => {
  const createService = ({
    rows = [],
    cached = null as string | null,
  }: {
    rows?: SearchSynonym[];
    cached?: string | null;
  } = {}) => {
    const synonymRepository = {
      find: jest.fn(async () => rows),
      findOne: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'syn-1', createdAt: new Date(), ...value })),
      delete: jest.fn(async () => ({ affected: 1 })),
    } as unknown as Repository<SearchSynonym>;

    const redisService = {
      get: jest.fn(async () => cached),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined),
    };

    return {
      service: new SearchSynonymService(synonymRepository, redisService as never),
      synonymRepository,
      redisService,
    };
  };

  it('expands query case-insensitively when a synonym term matches', async () => {
    const { service } = createService({
      cached: JSON.stringify([{ terms: ['royal'], expansion: 'Royal Canin' }]),
    });

    await expect(service.expandQuery('ROYAL food')).resolves.toBe('ROYAL food Royal Canin');
  });

  it('returns original query when no synonym matches', async () => {
    const { service } = createService({ cached: '[]' });
    await expect(service.expandQuery('cat food')).resolves.toBe('cat food');
  });

  it('rejects more than 20 synonym terms', () => {
    const { service } = createService();
    const terms = Array.from({ length: 21 }, (_, index) => `term-${index}`);

    expect(() => service.normalizeTerms(terms)).toThrow(BadRequestException);
  });

  it('loads synonyms from DB when Redis cache misses', async () => {
    const { service, synonymRepository, redisService } = createService({
      rows: [
        {
          id: 'syn-1',
          terms: ['dog'],
          expansion: 'Canine',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });

    await expect(service.expandQuery('dog food')).resolves.toBe('dog food Canine');
    expect(synonymRepository.find).toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalled();
  });
});
