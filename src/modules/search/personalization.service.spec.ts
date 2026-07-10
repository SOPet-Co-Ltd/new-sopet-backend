import { PersonalizationService } from './personalization.service';
import type { Repository } from 'typeorm';
import type { UserSearchProfile } from '../../database/entities/user-search-profile.entity';

describe('PersonalizationService', () => {
  const repository = {
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<UserSearchProfile>;

  const service = new PersonalizationService(repository);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns neutral boost when no history is available', async () => {
    const profile = await service.buildProfile(undefined, undefined, []);
    const boost = service.computeBoost({ id: 'p1', name: 'Dog Food' }, profile);
    expect(boost).toBe(0);
  });

  it('reorders ids without dropping any matched id', () => {
    const profile = {
      petTypeIds: ['pet-1'],
      brandIds: [],
      categoryIds: [],
      queryTokens: [],
    };
    const scoreById = new Map([
      ['p1', 0.5],
      ['p2', 0.49],
    ]);
    const productsById = new Map([
      ['p1', { id: 'p1', petTypeId: 'pet-2', name: 'A' }],
      ['p2', { id: 'p2', petTypeId: 'pet-1', name: 'B' }],
    ]);

    const reordered = service.reorderIds(['p1', 'p2'], scoreById, productsById, profile, 0.1);

    expect(new Set(reordered)).toEqual(new Set(['p1', 'p2']));
    expect(reordered[0]).toBe('p2');
  });

  it('caps personalization boost at the configured cap', () => {
    const profile = {
      petTypeIds: ['pet-1'],
      brandIds: ['brand-1'],
      categoryIds: ['cat-1'],
      queryTokens: ['premium'],
    };

    const boost = service.computeBoost(
      {
        id: 'p1',
        petTypeId: 'pet-1',
        brandId: 'brand-1',
        categoryId: 'cat-1',
        name: 'Premium Dog Food',
      },
      profile,
    );

    expect(boost).toBeLessThanOrEqual(0.2);
    expect(boost).toBeGreaterThan(0);
  });
});
