import { generateKeyPairSync } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import {
  CARD_TRANSPORT_PREFIX,
  decryptCardSecurityCodeTransport,
  decryptCardTransportPayload,
  encryptCardTransportForTests,
  getCardTransportPublicKeyPem,
} from './card-transport-crypto.util';

describe('card-transport-crypto', () => {
  const previous = process.env.CARD_TRANSPORT_PRIVATE_KEY;
  let privatePem: string;

  beforeAll(() => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privatePem = privateKey;
    process.env.CARD_TRANSPORT_PRIVATE_KEY = privatePem;
  });

  afterAll(() => {
    process.env.CARD_TRANSPORT_PRIVATE_KEY = previous;
  });

  it('exposes an SPKI public key PEM', () => {
    const pem = getCardTransportPublicKeyPem();
    expect(pem).toContain('BEGIN PUBLIC KEY');
    expect(pem).not.toContain('PRIVATE');
  });

  it('round-trips card payload encryption', () => {
    const payload = {
      cardholderName: 'Test User',
      pan: '4111111111111111',
      expiryMonth: 12,
      expiryYear: 2030,
    };
    const cipher = encryptCardTransportForTests(JSON.stringify(payload));
    expect(cipher.startsWith(CARD_TRANSPORT_PREFIX)).toBe(true);
    expect(cipher).not.toContain('4111111111111111');
    expect(decryptCardTransportPayload(cipher)).toEqual(payload);
  });

  it('round-trips CVV encryption', () => {
    const cipher = encryptCardTransportForTests('123');
    expect(cipher).not.toContain('123');
    expect(decryptCardSecurityCodeTransport(cipher)).toBe('123');
  });

  it('rejects plaintext PAN', () => {
    expect(() => decryptCardTransportPayload('4111111111111111')).toThrow(BadRequestException);
  });

  it('rejects plaintext CVV', () => {
    expect(() => decryptCardSecurityCodeTransport('123')).toThrow(BadRequestException);
  });

  it('rejects missing cipher prefix', () => {
    expect(() => decryptCardTransportPayload('not-a-cipher')).toThrow(BadRequestException);
  });

  it('accepts a PEM stored with literal \\n escapes', () => {
    const escaped = privatePem.replace(/\r/g, '').replace(/\n/g, '\\n');
    process.env.CARD_TRANSPORT_PRIVATE_KEY = escaped;
    expect(getCardTransportPublicKeyPem()).toContain('BEGIN PUBLIC KEY');
    process.env.CARD_TRANSPORT_PRIVATE_KEY = privatePem;
  });

  it('throws when private key is missing', () => {
    const key = process.env.CARD_TRANSPORT_PRIVATE_KEY;
    delete process.env.CARD_TRANSPORT_PRIVATE_KEY;
    expect(() => getCardTransportPublicKeyPem()).toThrow('CARD_TRANSPORT_PRIVATE_KEY is required');
    process.env.CARD_TRANSPORT_PRIVATE_KEY = key;
  });
});
