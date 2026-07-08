import { normalizeCheckoutPaymentMethod } from './checkout-payment.util';

describe('normalizeCheckoutPaymentMethod', () => {
  it('maps card alias to credit_card', () => {
    expect(normalizeCheckoutPaymentMethod('card')).toBe('credit_card');
  });

  it('passes through supported values', () => {
    expect(normalizeCheckoutPaymentMethod('promptpay')).toBe('promptpay');
    expect(normalizeCheckoutPaymentMethod('credit_card')).toBe('credit_card');
    expect(normalizeCheckoutPaymentMethod('cod')).toBe('cod');
  });
});
