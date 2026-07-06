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
 * Normalize a Thai phone number to local `0`-leading format (e.g. `+66812345678` -> `0812345678`).
 * Non-Thai or unrecognizable values are returned trimmed and unchanged.
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
