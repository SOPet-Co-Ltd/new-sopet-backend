import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Beam webhook HMAC: base64(HMAC-SHA256(rawBody, decoded BEAM_WEBHOOK_SECRET)).
 * Header: X-Beam-Signature
 */
export function computeBeamWebhookSignature(
  rawBody: string | Buffer,
  webhookSecretBase64: string,
): string {
  const secret = Buffer.from(webhookSecretBase64, 'base64');
  const body = typeof rawBody === 'string' ? Buffer.from(rawBody) : rawBody;
  return createHmac('sha256', secret).update(body).digest('base64');
}

export function verifyBeamWebhookSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  webhookSecretBase64: string,
): boolean {
  if (!signatureHeader || !webhookSecretBase64) {
    return false;
  }

  try {
    const expected = computeBeamWebhookSignature(rawBody, webhookSecretBase64);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signatureHeader.trim());
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}
