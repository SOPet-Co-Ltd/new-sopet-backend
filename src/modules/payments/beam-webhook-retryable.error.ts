/**
 * Transient Beam webhook failure. Controller maps this to HTTP 503 so Beam retries.
 * Durable outcomes (paid, failed, already paid, cancelled/refunded, amount mismatch) must not throw this.
 */
export class BeamWebhookRetryableError extends Error {
  readonly code = 'BEAM_WEBHOOK_RETRYABLE';

  constructor(message: string) {
    super(message);
    this.name = 'BeamWebhookRetryableError';
  }
}
