import otpConfig, { assertOtpHmacSecret } from './otp.config';

describe('otp config bypassCode', () => {
  const original = process.env.OTP_BYPASS_CODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OTP_BYPASS_CODE;
    } else {
      process.env.OTP_BYPASS_CODE = original;
    }
  });

  it('is unset when OTP_BYPASS_CODE is missing', () => {
    delete process.env.OTP_BYPASS_CODE;
    expect(otpConfig()).toEqual(expect.objectContaining({ bypassCode: undefined }));
  });

  it('reads a 6-digit OTP_BYPASS_CODE', () => {
    process.env.OTP_BYPASS_CODE = '000000';
    expect(otpConfig()).toEqual(expect.objectContaining({ bypassCode: '000000' }));
  });
});

describe('assertOtpHmacSecret', () => {
  it('allows missing secret outside production', () => {
    expect(assertOtpHmacSecret(undefined, 'development')).toBeUndefined();
  });

  it('requires secret in production', () => {
    expect(() => assertOtpHmacSecret(undefined, 'production')).toThrow(/OTP_HMAC_SECRET/);
  });

  it('rejects reuse of JWT_SECRET in production', () => {
    const secret = 'a'.repeat(40);
    expect(() => assertOtpHmacSecret(secret, 'production', secret)).toThrow(/must not equal/);
  });

  it('accepts a dedicated production secret', () => {
    expect(assertOtpHmacSecret('b'.repeat(40), 'production', 'a'.repeat(40))).toBe('b'.repeat(40));
  });
});
