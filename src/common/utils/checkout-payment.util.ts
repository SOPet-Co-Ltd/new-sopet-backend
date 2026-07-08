export type CheckoutPaymentMethod = 'promptpay' | 'credit_card' | 'cod';

export function normalizeCheckoutPaymentMethod(paymentMethod: string): CheckoutPaymentMethod {
  if (paymentMethod === 'card') {
    return 'credit_card';
  }

  if (paymentMethod === 'promptpay' || paymentMethod === 'credit_card' || paymentMethod === 'cod') {
    return paymentMethod;
  }

  throw new Error(`Unsupported payment method: ${paymentMethod}`);
}
