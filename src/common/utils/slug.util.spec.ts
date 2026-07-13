import {
  generateRandomSlug,
  generateSlug,
  generateUniqueStoreSlug,
  isAllThaiStoreName,
} from './slug.util';

describe('generateSlug', () => {
  it('slugifies Latin names', () => {
    expect(generateSlug('Dog Food')).toBe('dog-food');
  });

  it('preserves Thai letters', () => {
    expect(generateSlug('อาหารสุนัขออร์แกนิก')).toBe('อาหารสุนัขออร์แกนิก');
  });

  it('combines Thai and Latin', () => {
    expect(generateSlug('Dog Food 5kg')).toBe('dog-food-5kg');
  });

  it('falls back when name has no slug characters', () => {
    expect(generateSlug('!!!', 'product')).toBe('product');
  });
});

describe('isAllThaiStoreName', () => {
  it('returns true for Thai-only names', () => {
    expect(isAllThaiStoreName('ร้านอาหารสัตว์')).toBe(true);
    expect(isAllThaiStoreName('อาหารสุนัข 123')).toBe(true);
  });

  it('returns false when Latin letters are present', () => {
    expect(isAllThaiStoreName('Pet Shop')).toBe(false);
    expect(isAllThaiStoreName('ร้าน Pet')).toBe(false);
    expect(isAllThaiStoreName('อาหารสุนัข 5kg')).toBe(false);
  });

  it('returns false when there are no letters', () => {
    expect(isAllThaiStoreName('123')).toBe(false);
    expect(isAllThaiStoreName('!!!')).toBe(false);
  });
});

describe('generateRandomSlug', () => {
  it('returns a short lowercase alphanumeric slug', () => {
    const slug = generateRandomSlug();
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
  });

  it('respects custom length', () => {
    expect(generateRandomSlug(6)).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe('generateUniqueStoreSlug', () => {
  it('uses slugified Latin name when available and unique', async () => {
    const slug = await generateUniqueStoreSlug('My Pet Shop', async () => false);
    expect(slug).toBe('my-pet-shop');
  });

  it('uses random slug for all-Thai names', async () => {
    const slug = await generateUniqueStoreSlug(
      'ร้านอาหารสัตว์',
      async () => false,
      () => 'abc7x2k9',
    );
    expect(slug).toBe('abc7x2k9');
  });

  it('uses random slug when slugified name collides', async () => {
    const slug = await generateUniqueStoreSlug(
      'My Store',
      async (candidate) => candidate === 'my-store',
      () => 'xyz9a1b2',
    );
    expect(slug).toBe('xyz9a1b2');
  });

  it('uses random slug when slugified name is only the fallback', async () => {
    const slug = await generateUniqueStoreSlug(
      '!!!',
      async () => false,
      () => 'fallback1',
    );
    expect(slug).toBe('fallback1');
  });

  it('retries random slug until unique', async () => {
    const taken = new Set(['taken01', 'taken02']);
    let calls = 0;
    const slug = await generateUniqueStoreSlug(
      'ร้านไทย',
      async (candidate) => taken.has(candidate),
      () => {
        calls += 1;
        return calls === 1 ? 'taken01' : 'free9x8y';
      },
    );
    expect(slug).toBe('free9x8y');
    expect(calls).toBe(2);
  });

  it('throws after max attempts', async () => {
    await expect(
      generateUniqueStoreSlug(
        'ร้านไทย',
        async () => true,
        () => 'taken99',
      ),
    ).rejects.toThrow('Failed to generate unique store slug');
  });
});
