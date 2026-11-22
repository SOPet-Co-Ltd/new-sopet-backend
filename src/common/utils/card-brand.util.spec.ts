import { detectCardBrand, isValidLuhn, normalizePan, toBeamExpiryYearYy } from './card-brand.util';

describe('card-brand.util', () => {
  it('detects common brands', () => {
    expect(detectCardBrand('4111111111111111')).toBe('visa');
    expect(detectCardBrand('5555555555554444')).toBe('mastercard');
    expect(detectCardBrand('378282246310005')).toBe('amex');
  });

  it('validates Luhn', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
    expect(isValidLuhn('4111111111111112')).toBe(false);
  });

  it('normalizes PAN digits', () => {
    expect(normalizePan('4111 1111 1111 1111')).toBe('4111111111111111');
  });

  it('converts full year to YY for Beam', () => {
    expect(toBeamExpiryYearYy(2030)).toBe(30);
  });
});
