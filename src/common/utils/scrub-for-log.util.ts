/**
 * Redacts secrets and high-sensitivity fields before logging payment-provider payloads.
 */
const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|authorization|card_number|security_code|cvv|cvc|pan|bank_account)/i;

export function scrubForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) {
    return '[Truncated]';
  }

  if (value == null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => scrubForLog(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[Redacted]';
      } else {
        out[key] = scrubForLog(nested, depth + 1);
      }
    }
    return out;
  }

  return typeof value === 'bigint' ? value.toString() : '[Unserializable]';
}

export function scrubJsonForLog(value: unknown): string {
  try {
    return JSON.stringify(scrubForLog(value));
  } catch {
    return '[Unserializable]';
  }
}
