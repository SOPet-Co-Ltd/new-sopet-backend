export type CheckoutPaymentMethod = 'promptpay' | 'credit_card' | 'cod' | 'bank_transfer';

export function normalizeCheckoutPaymentMethod(paymentMethod: string): CheckoutPaymentMethod {
  if (paymentMethod === 'card') {
    return 'credit_card';
  }

  if (
    paymentMethod === 'promptpay' ||
    paymentMethod === 'credit_card' ||
    paymentMethod === 'cod' ||
    paymentMethod === 'bank_transfer'
  ) {
    return paymentMethod;
  }

  throw new Error(`Unsupported payment method: ${paymentMethod}`);
}

export function isNonOmiseCheckoutPaymentMethod(method: CheckoutPaymentMethod): boolean {
  return method === 'cod' || method === 'bank_transfer';
}
