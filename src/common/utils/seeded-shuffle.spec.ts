import { seededShuffle } from './seeded-shuffle';

describe('seededShuffle', () => {
  it('returns the same order for the same seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];

    expect(seededShuffle(items, 'seed-a')).toEqual(seededShuffle(items, 'seed-a'));
  });

  it('returns a different order for different seeds', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

    expect(seededShuffle(items, 'seed-a')).not.toEqual(seededShuffle(items, 'seed-b'));
  });

  it('preserves all items', () => {
    const items = ['a', 'b', 'c', 'd'];

    expect(seededShuffle(items, 'seed-a').sort()).toEqual(items.sort());
  });
});
