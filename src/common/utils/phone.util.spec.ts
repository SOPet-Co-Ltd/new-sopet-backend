import { normalizeThaiPhoneToLocal, guestPhoneLookupValues } from './phone.util';

describe('normalizeThaiPhoneToLocal', () => {
  it('converts +66 numbers to local 0-leading format', () => {
    expect(normalizeThaiPhoneToLocal('+66811112222')).toBe('0811112222');
  });

  it('keeps already-local numbers unchanged', () => {
    expect(normalizeThaiPhoneToLocal('0811112222')).toBe('0811112222');
  });

  it('handles 66-prefixed numbers without the plus', () => {
    expect(normalizeThaiPhoneToLocal('66811112222')).toBe('0811112222');
  });

  it('strips formatting characters', () => {
    expect(normalizeThaiPhoneToLocal('081-111-2222')).toBe('0811112222');
  });

  it('returns empty string for nullish values', () => {
    expect(normalizeThaiPhoneToLocal(null)).toBe('');
    expect(normalizeThaiPhoneToLocal(undefined)).toBe('');
  });

  it('leaves non-Thai international numbers unchanged', () => {
    expect(normalizeThaiPhoneToLocal('+14155552671')).toBe('+14155552671');
  });
});

describe('guestPhoneLookupValues', () => {
  it('includes local and legacy E.164 variants for Thai numbers', () => {
    expect(guestPhoneLookupValues('0812345678')).toEqual(
      expect.arrayContaining(['0812345678', '+66812345678']),
    );
  });
});
