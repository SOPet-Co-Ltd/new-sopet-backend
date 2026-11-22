export type CheckoutPaymentMethod =
  'promptpay' | 'credit_card' | 'cod' | 'bank_transfer' | 'truemoney' | 'shopeepay';

export type OmiseWalletPlatformType = 'IOS' | 'ANDROID' | 'WEB';

const SUPPORTED_METHODS = new Set<CheckoutPaymentMethod>([
  'promptpay',
  'credit_card',
  'cod',
  'bank_transfer',
  'truemoney',
  'shopeepay',
]);

export function normalizeCheckoutPaymentMethod(paymentMethod: string): CheckoutPaymentMethod {
  if (paymentMethod === 'card') {
    return 'credit_card';
  }

  if (SUPPORTED_METHODS.has(paymentMethod as CheckoutPaymentMethod)) {
    return paymentMethod as CheckoutPaymentMethod;
  }

  throw new Error(`Unsupported payment method: ${paymentMethod}`);
}

export function isNonOmiseCheckoutPaymentMethod(method: CheckoutPaymentMethod): boolean {
  return method === 'cod' || method === 'bank_transfer';
}

export function isOmiseWalletPaymentMethod(
  method: CheckoutPaymentMethod,
): method is 'truemoney' | 'shopeepay' {
  return method === 'truemoney' || method === 'shopeepay';
}

/** Always JumpApp — works for desktop and mobile browsers. */
export function resolveOmiseWalletSource(params: {
  paymentMethod: 'truemoney' | 'shopeepay';
  platformType?: OmiseWalletPlatformType;
}): { type: string; platform_type?: OmiseWalletPlatformType } {
  const type = params.paymentMethod === 'truemoney' ? 'truemoney_jumpapp' : 'shopeepay_jumpapp';
  const source: { type: string; platform_type?: OmiseWalletPlatformType } = { type };
  if (params.platformType === 'IOS' || params.platformType === 'ANDROID') {
    source.platform_type = params.platformType;
  }
  return source;
}
