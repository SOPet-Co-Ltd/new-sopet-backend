import { createHmac, timingSafeEqual } from 'crypto';

const REPLAY_MAX_AGE_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function isTimestampFresh(timestamp: string): boolean {
  const tsSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(tsSeconds)) {
    return false;
  }
  const ageMs = Date.now() - tsSeconds * 1000;
  return ageMs <= REPLAY_MAX_AGE_MS && ageMs >= -CLOCK_SKEW_MS;
}

export function computeOmiseWebhookSignature(
  rawBody: string,
  timestamp: string,
  webhookSecretBase64: string,
): string {
  const decodedSecret = Buffer.from(webhookSecretBase64, 'base64');
  const signedPayload = `${timestamp}.${rawBody}`;
  return createHmac('sha256', decodedSecret).update(signedPayload).digest('hex');
}

export function verifyOmiseWebhookSignature(
  rawBody: string,
  timestamp: string | undefined,
  signatureHeader: string | undefined,
  webhookSecretBase64: string,
): boolean {
  if (!timestamp || !signatureHeader) {
    return false;
  }
  if (!isTimestampFresh(timestamp)) {
    return false;
  }

  const expected = computeOmiseWebhookSignature(rawBody, timestamp, webhookSecretBase64);
  const signatures = signatureHeader.split(',').map((s) => s.trim());

  return signatures.some((sig) => timingSafeEqualHex(sig, expected));
}
