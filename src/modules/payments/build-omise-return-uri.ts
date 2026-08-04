/**
 * Builds Omise credit_card charge `return_uri`.
 * Origin trailing slash is stripped so `/payment/{id}` is not doubled.
 */
export function buildOmiseReturnUri(storefrontUrl: string, paymentId: string): string {
  const origin = storefrontUrl.replace(/\/$/, '');
  if (!origin) {
    throw new Error('STOREFRONT_URL_EMPTY');
  }
  return `${origin}/payment/${paymentId}`;
}
