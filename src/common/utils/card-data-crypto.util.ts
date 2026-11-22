import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

function requireCardEncryptionKey(): string {
  const secret = process.env.CARD_DATA_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error('CARD_DATA_ENCRYPTION_KEY is required to encrypt or decrypt card data');
  }
  return secret;
}

/**
 * Encrypts saved-card fields at rest (AES-256-GCM). Fail-closed: missing key throws.
 * Unique IV per value. Never log plaintext or ciphertext payloads.
 */
export function encryptCardField(plaintext: string): string {
  if (plaintext == null || plaintext === '') {
    throw new Error('Card field plaintext is required');
  }
  if (plaintext.startsWith(PREFIX)) {
    return plaintext;
  }

  const secret = requireCardEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptCardField(stored: string): string {
  if (stored == null || stored === '') {
    throw new Error('Encrypted card field is required');
  }
  if (!stored.startsWith(PREFIX)) {
    throw new Error('Invalid encrypted card payload');
  }

  const secret = requireCardEncryptionKey();
  const payload = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted card payload');
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export type EncryptedCardExpiry = {
  month: number;
  year: number;
};

export function encryptCardExpiry(expiry: EncryptedCardExpiry): string {
  return encryptCardField(JSON.stringify({ month: expiry.month, year: expiry.year }));
}

export function decryptCardExpiry(stored: string): EncryptedCardExpiry {
  const raw = decryptCardField(stored);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid encrypted card expiry payload');
  }
  if (
    typeof parsed !== 'object' ||
    parsed == null ||
    typeof (parsed as EncryptedCardExpiry).month !== 'number' ||
    typeof (parsed as EncryptedCardExpiry).year !== 'number'
  ) {
    throw new Error('Invalid encrypted card expiry payload');
  }
  return {
    month: (parsed as EncryptedCardExpiry).month,
    year: (parsed as EncryptedCardExpiry).year,
  };
}
