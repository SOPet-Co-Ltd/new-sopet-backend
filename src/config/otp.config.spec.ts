import { assertOtpHmacSecret } from './otp.config';

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
