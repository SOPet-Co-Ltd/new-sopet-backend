import {
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  constants,
  type KeyObject,
} from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export const CARD_TRANSPORT_PREFIX = 'rsa:v1:';

export type CardTransportPlainPayload = {
  cardholderName: string;
  pan: string;
  expiryMonth: number;
  expiryYear: number;
};

function normalizePem(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.includes('\\n') ? trimmed.replace(/\\n/g, '\n') : trimmed;
}

function requirePrivateKeyPem(): string {
  const secret = process.env.CARD_TRANSPORT_PRIVATE_KEY?.trim();
  if (!secret) {
    throw new Error('CARD_TRANSPORT_PRIVATE_KEY is required to decrypt card transport payloads');
  }
  return normalizePem(secret);
}

function loadPrivateKey(): KeyObject {
  return createPrivateKey(requirePrivateKeyPem());
}

/** SPKI PEM for browser RSA-OAEP encryption. Safe to expose publicly. */
export function getCardTransportPublicKeyPem(): string {
  const publicKey = createPublicKey(loadPrivateKey());
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

function looksLikePlainPanOrCvv(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 13 && digits.length <= 19 && digits === value.replace(/\s|-/g, '')) {
    return true;
  }
  return /^\d{3,4}$/.test(value.trim());
}

function assertCipherPayload(payload: string): string {
  if (payload == null || payload === '') {
    throw new BadRequestException({
      code: 'INVALID_CARD_CIPHER',
      message: 'Encrypted card payload is required',
    });
  }

  if (looksLikePlainPanOrCvv(payload) || !payload.startsWith(CARD_TRANSPORT_PREFIX)) {
    throw new BadRequestException({
      code: 'PLAINTEXT_CARD_REJECTED',
      message: 'Card data must be encrypted before sending',
    });
  }

  return payload.slice(CARD_TRANSPORT_PREFIX.length);
}

function decryptRaw(cipherB64Url: string): string {
  try {
    const privateKey = loadPrivateKey();
    const buffer = Buffer.from(cipherB64Url, 'base64url');
    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      buffer,
    );
    return decrypted.toString('utf8');
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException({
      code: 'INVALID_CARD_CIPHER',
      message: 'Encrypted card payload is invalid',
    });
  }
}

/** Decrypt RSA-OAEP ciphertext of card JSON. Rejects plaintext PAN. */
export function decryptCardTransportPayload(payload: string): CardTransportPlainPayload {
  const cipherB64Url = assertCipherPayload(payload);
  const raw = decryptRaw(cipherB64Url);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException({
      code: 'INVALID_CARD_CIPHER',
      message: 'Encrypted card payload is invalid',
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new BadRequestException({
      code: 'INVALID_CARD_CIPHER',
      message: 'Encrypted card payload is invalid',
    });
  }

  const record = parsed as Record<string, unknown>;
  const cardholderName = typeof record.cardholderName === 'string' ? record.cardholderName : '';
  const pan = typeof record.pan === 'string' ? record.pan : '';
  const expiryMonth = Number(record.expiryMonth);
  const expiryYear = Number(record.expiryYear);

  if (
    !cardholderName.trim() ||
    !pan.trim() ||
    !Number.isFinite(expiryMonth) ||
    !Number.isFinite(expiryYear)
  ) {
    throw new BadRequestException({
      code: 'INVALID_CARD_CIPHER',
      message: 'Encrypted card payload is invalid',
    });
  }

  return {
    cardholderName,
    pan,
    expiryMonth,
    expiryYear,
  };
}

/** Decrypt RSA-OAEP ciphertext of a CVV string. Rejects plaintext CVV. */
export function decryptCardSecurityCodeTransport(payload: string): string {
  const cipherB64Url = assertCipherPayload(payload);
  const cvv = decryptRaw(cipherB64Url).trim();
  if (!/^\d{3,4}$/.test(cvv)) {
    throw new BadRequestException({
      code: 'INVALID_CARD_SECURITY_CODE',
      message: 'Card security code is invalid',
    });
  }
  return cvv;
}

/**
 * Test/helper: encrypt with the configured private key's public half.
 * Production clients encrypt in the browser; do not use this for client traffic.
 */
export function encryptCardTransportForTests(plaintext: string): string {
  const publicKey = createPublicKey(loadPrivateKey());
  const encrypted = publicEncrypt(
    {
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(plaintext, 'utf8'),
  );
  return `${CARD_TRANSPORT_PREFIX}${encrypted.toString('base64url')}`;
}
