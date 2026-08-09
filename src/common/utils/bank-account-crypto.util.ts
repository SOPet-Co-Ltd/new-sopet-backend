import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * Encrypts vendor bank account numbers at rest when BANK_DATA_ENCRYPTION_KEY is set.
 * Plaintext values without the prefix remain readable for migration compatibility.
 */
export function encryptBankAccountNumber(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') {
    return plaintext ?? null;
  }
  if (plaintext.startsWith(PREFIX)) {
    return plaintext;
  }

  const secret = process.env.BANK_DATA_ENCRYPTION_KEY?.trim();
  if (!secret) {
    return plaintext;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptBankAccountNumber(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') {
    return stored ?? null;
  }
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }

  const secret = process.env.BANK_DATA_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error('BANK_DATA_ENCRYPTION_KEY is required to decrypt bank account numbers');
  }

  const payload = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted bank account payload');
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

/** Mask for logs / low-privilege displays: keep last 4 digits when possible. */
export function maskBankAccountNumber(value: string | null | undefined): string | null {
  if (value == null || value === '') {
    return value ?? null;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) {
    return '****';
  }
  return `****${digits.slice(-4)}`;
}
