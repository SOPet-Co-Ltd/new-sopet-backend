import {
  hashOtpCode,
  isAcceptedOtpCode,
  otpBypassMatches,
  otpHashesMatch,
  parseOtpBypassCode,
} from './otp-code.util';

const HMAC_SECRET = 'test-otp-hmac-secret';

describe('parseOtpBypassCode', () => {
  it('returns undefined when unset or blank', () => {
    expect(parseOtpBypassCode(undefined)).toBeUndefined();
    expect(parseOtpBypassCode('')).toBeUndefined();
    expect(parseOtpBypassCode('   ')).toBeUndefined();
  });

  it('accepts an exact 6-digit code', () => {
    expect(parseOtpBypassCode('000000')).toBe('000000');
    expect(parseOtpBypassCode(' 123456 ')).toBe('123456');
  });

  it('rejects codes that are not exactly 6 digits', () => {
    expect(() => parseOtpBypassCode('00000')).toThrow(/OTP_BYPASS_CODE/);
    expect(() => parseOtpBypassCode('00000000')).toThrow(/OTP_BYPASS_CODE/);
    expect(() => parseOtpBypassCode('abcdef')).toThrow(/OTP_BYPASS_CODE/);
  });
});

describe('otpBypassMatches', () => {
  it('returns false when bypass is unset', () => {
    expect(otpBypassMatches('000000', undefined)).toBe(false);
  });

  it('matches the configured bypass code', () => {
    expect(otpBypassMatches('000000', '000000')).toBe(true);
  });

  it('rejects a different code', () => {
    expect(otpBypassMatches('123456', '000000')).toBe(false);
  });
});

describe('isAcceptedOtpCode', () => {
  const storedHash = hashOtpCode('123456', HMAC_SECRET);

  it('accepts a hashed SMS code without bypass', () => {
    expect(isAcceptedOtpCode(storedHash, '123456', HMAC_SECRET, undefined)).toBe(true);
  });

  it('accepts the bypass code even when it does not match the SMS hash', () => {
    expect(isAcceptedOtpCode(storedHash, '000000', HMAC_SECRET, '000000')).toBe(true);
  });

  it('rejects a wrong code when bypass is unset', () => {
    expect(isAcceptedOtpCode(storedHash, '000000', HMAC_SECRET, undefined)).toBe(false);
  });

  it('rejects a wrong code that is not the bypass', () => {
    expect(isAcceptedOtpCode(storedHash, '111111', HMAC_SECRET, '000000')).toBe(false);
  });
});

describe('otpHashesMatch', () => {
  it('matches the HMAC of the provided code', () => {
    const stored = hashOtpCode('654321', HMAC_SECRET);
    expect(otpHashesMatch(stored, '654321', HMAC_SECRET)).toBe(true);
    expect(otpHashesMatch(stored, '000000', HMAC_SECRET)).toBe(false);
  });
});
