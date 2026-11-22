import {
  decryptCardExpiry,
  decryptCardField,
  encryptCardExpiry,
  encryptCardField,
} from './card-data-crypto.util';

describe('card-data-crypto', () => {
  const previous = process.env.CARD_DATA_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.CARD_DATA_ENCRYPTION_KEY = 'test-card-encryption-key';
  });

  afterAll(() => {
    process.env.CARD_DATA_ENCRYPTION_KEY = previous;
  });

  it('round-trips encryption', () => {
    const encrypted = encryptCardField('4111111111111111');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptCardField(encrypted)).toBe('4111111111111111');
  });

  it('uses a unique IV per encryption', () => {
    const a = encryptCardField('4111111111111111');
    const b = encryptCardField('4111111111111111');
    expect(a).not.toBe(b);
    expect(decryptCardField(a)).toBe('4111111111111111');
    expect(decryptCardField(b)).toBe('4111111111111111');
  });

  it('round-trips expiry', () => {
    const encrypted = encryptCardExpiry({ month: 12, year: 2030 });
    expect(decryptCardExpiry(encrypted)).toEqual({ month: 12, year: 2030 });
  });

  it('throws when key is missing on encrypt', () => {
    const key = process.env.CARD_DATA_ENCRYPTION_KEY;
    delete process.env.CARD_DATA_ENCRYPTION_KEY;
    expect(() => encryptCardField('4111111111111111')).toThrow(
      'CARD_DATA_ENCRYPTION_KEY is required',
    );
    process.env.CARD_DATA_ENCRYPTION_KEY = key;
  });

  it('throws when key is missing on decrypt', () => {
    const encrypted = encryptCardField('John Doe');
    const key = process.env.CARD_DATA_ENCRYPTION_KEY;
    delete process.env.CARD_DATA_ENCRYPTION_KEY;
    expect(() => decryptCardField(encrypted)).toThrow('CARD_DATA_ENCRYPTION_KEY is required');
    process.env.CARD_DATA_ENCRYPTION_KEY = key;
  });

  it('throws on empty plaintext', () => {
    expect(() => encryptCardField('')).toThrow('Card field plaintext is required');
  });

  it('throws on invalid ciphertext', () => {
    expect(() => decryptCardField('not-encrypted')).toThrow('Invalid encrypted card payload');
  });
});
