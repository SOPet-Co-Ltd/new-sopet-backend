const THAI_SUBSCRIBER_LENGTH = 9;

/** Extract the 9-digit Thai subscriber number from any accepted input format. */
function getThaiSubscriber(value: string): string {
  const digits = value.replace(/\D/g, '');

  if (digits.startsWith('660')) {
    return digits.slice(3, 3 + THAI_SUBSCRIBER_LENGTH);
  }

  if (digits.startsWith('66')) {
    return digits.slice(2, 2 + THAI_SUBSCRIBER_LENGTH);
  }

  if (digits.startsWith('0')) {
    return digits.slice(1, 1 + THAI_SUBSCRIBER_LENGTH);
  }

  return digits.slice(0, THAI_SUBSCRIBER_LENGTH);
}

/**
 * Normalize a Thai phone number to local `0`-leading format (e.g. `0812345678`).
 * Accepts common input variants (+66, 66, dashes) but always returns local format.
 */
export function normalizeThaiPhoneToLocal(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('+') && !trimmed.startsWith('+66')) {
    return trimmed;
  }

  const subscriber = getThaiSubscriber(trimmed);
  if (subscriber.length === THAI_SUBSCRIBER_LENGTH) {
    return `0${subscriber}`;
  }

  return trimmed;
}

/** Lookup values for phone fields. Returns local format; includes legacy +66 rows when present. */
export function guestPhoneLookupValues(value: string): string[] {
  const trimmed = value.trim();
  const local = normalizeThaiPhoneToLocal(trimmed);
  const variants = new Set<string>([local].filter(Boolean));

  // Match legacy rows stored as E.164 before local-only normalization.
  if (local.startsWith('0') && local.length === 10) {
    variants.add(`+66${local.slice(1)}`);
  }

  return [...variants];
}
