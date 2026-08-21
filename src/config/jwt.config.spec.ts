import { assertJwtSecretStrength } from './jwt.config';

describe('assertJwtSecretStrength', () => {
  it('allows short secrets outside production', () => {
    expect(() => assertJwtSecretStrength('short', 'development')).not.toThrow();
  });

  it('rejects missing secret', () => {
    expect(() => assertJwtSecretStrength(undefined, 'development')).toThrow(/JWT_SECRET/);
  });

  it('rejects short secrets in production', () => {
    expect(() => assertJwtSecretStrength('too-short-for-production', 'production')).toThrow(
      /at least 32/,
    );
  });

  it('rejects placeholder secrets in production', () => {
    const placeholder = 'change-me-to-a-long-random-string-in-production';
    expect(() => assertJwtSecretStrength(placeholder, 'production')).toThrow(/placeholder/);
  });

  it('accepts a strong production secret', () => {
    const secret = 'a'.repeat(32) + '-strong-random-value';
    expect(() => assertJwtSecretStrength(secret, 'production')).not.toThrow();
  });
});
