import { RrfEngine } from './rrf.engine';

describe('RrfEngine', () => {
  const engine = new RrfEngine();

  it('merges leg rank positions using reciprocal rank fusion', () => {
    const merged = engine.merge(
      [
        ['a', 'b', 'c'],
        ['b', 'd', 'a'],
      ],
      60,
    );

    expect(merged[0]).toBe('b');
    expect(merged[1]).toBe('a');
    expect(merged).toEqual(expect.arrayContaining(['c', 'd']));
  });

  it('uses deterministic id ordering for tied rrf scores', () => {
    const merged = engine.merge([['z-id'], ['a-id']], 60);
    expect(merged).toEqual(['a-id', 'z-id']);
  });
});
