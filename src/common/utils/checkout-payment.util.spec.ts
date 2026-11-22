import {
  isOmiseWalletPaymentMethod,
  normalizeCheckoutPaymentMethod,
  resolveOmiseWalletSource,
} from './checkout-payment.util';

describe('normalizeCheckoutPaymentMethod', () => {
  it('maps card alias to credit_card', () => {
    expect(normalizeCheckoutPaymentMethod('card')).toBe('credit_card');
  });

  it('passes through supported values', () => {
    expect(normalizeCheckoutPaymentMethod('promptpay')).toBe('promptpay');
    expect(normalizeCheckoutPaymentMethod('credit_card')).toBe('credit_card');
    expect(normalizeCheckoutPaymentMethod('cod')).toBe('cod');
    expect(normalizeCheckoutPaymentMethod('bank_transfer')).toBe('bank_transfer');
    expect(normalizeCheckoutPaymentMethod('truemoney')).toBe('truemoney');
    expect(normalizeCheckoutPaymentMethod('shopeepay')).toBe('shopeepay');
  });
});

describe('isOmiseWalletPaymentMethod', () => {
  it('returns true only for wallet methods', () => {
    expect(isOmiseWalletPaymentMethod('truemoney')).toBe(true);
    expect(isOmiseWalletPaymentMethod('shopeepay')).toBe(true);
    expect(isOmiseWalletPaymentMethod('promptpay')).toBe(false);
    expect(isOmiseWalletPaymentMethod('credit_card')).toBe(false);
  });
});

describe('resolveOmiseWalletSource', () => {
  it('always maps TrueMoney to jumpapp', () => {
    expect(
      resolveOmiseWalletSource({
        paymentMethod: 'truemoney',
        platformType: 'IOS',
      }),
    ).toEqual({ type: 'truemoney_jumpapp', platform_type: 'IOS' });

    expect(
      resolveOmiseWalletSource({
        paymentMethod: 'truemoney',
        platformType: 'WEB',
      }),
    ).toEqual({ type: 'truemoney_jumpapp' });
  });

  it('always maps ShopeePay to jumpapp', () => {
    expect(
      resolveOmiseWalletSource({
        paymentMethod: 'shopeepay',
        platformType: 'ANDROID',
      }),
    ).toEqual({ type: 'shopeepay_jumpapp', platform_type: 'ANDROID' });

    expect(
      resolveOmiseWalletSource({
        paymentMethod: 'shopeepay',
      }),
    ).toEqual({ type: 'shopeepay_jumpapp' });
  });
});
