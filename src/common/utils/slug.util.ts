import { randomBytes } from 'crypto';

const LATIN_LETTER = /[a-zA-Z]/;
const LETTER = /\p{L}/u;
const RANDOM_SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DEFAULT_RANDOM_SLUG_LENGTH = 8;
const MAX_UNIQUE_SLUG_ATTEMPTS = 20;

/** Slug for Thai + Latin names (keeps letters, numbers, and combining marks). */
export function generateSlug(name: string, fallback = 'item'): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}

/** True when the name has letters but no Latin (a-z) characters. */
export function isAllThaiStoreName(name: string): boolean {
  const trimmed = name.trim();
  return LETTER.test(trimmed) && !LATIN_LETTER.test(trimmed);
}

/** Short lowercase alphanumeric slug (default 8 chars). */
export function generateRandomSlug(length = DEFAULT_RANDOM_SLUG_LENGTH): string {
  const bytes = randomBytes(length);
  let slug = '';
  for (let i = 0; i < length; i++) {
    slug += RANDOM_SLUG_CHARS[bytes[i] % RANDOM_SLUG_CHARS.length];
  }
  return slug;
}

export async function generateUniqueStoreSlug(
  name: string,
  isSlugTaken: (slug: string) => Promise<boolean>,
  randomSlug: () => string = generateRandomSlug,
): Promise<string> {
  if (!isAllThaiStoreName(name)) {
    const candidate = generateSlug(name, 'store');
    if (candidate !== 'store' && !(await isSlugTaken(candidate))) {
      return candidate;
    }
  }

  for (let attempt = 0; attempt < MAX_UNIQUE_SLUG_ATTEMPTS; attempt++) {
    const slug = randomSlug();
    if (!(await isSlugTaken(slug))) {
      return slug;
    }
  }

  throw new Error('Failed to generate unique store slug');
}
