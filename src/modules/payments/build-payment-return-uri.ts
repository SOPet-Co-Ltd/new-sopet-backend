/**
 * Builds Beam charge `returnUrl`.
 * Origin trailing slash is stripped so `/payment/{id}` is not doubled.
 */
export function buildPaymentReturnUri(storefrontUrl: string, paymentId: string): string {
  const origin = storefrontUrl.replace(/\/$/, '');
  if (!origin) {
    throw new Error('STOREFRONT_URL_EMPTY');
  }
  return `${origin}/payment/${paymentId}`;
}
