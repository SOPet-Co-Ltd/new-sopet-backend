/** Slug for Thai + Latin names (keeps letters, numbers, and combining marks). */
export function generateSlug(name: string, fallback = 'item'): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return slug || fallback;
}
