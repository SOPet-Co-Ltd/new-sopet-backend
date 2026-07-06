import { generateSlug } from './slug.util';

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
