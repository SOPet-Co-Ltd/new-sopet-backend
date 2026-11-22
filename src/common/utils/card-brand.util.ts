/** Brand heuristic from PAN prefix (Visa / Mastercard / Amex / JCB). */
export function detectCardBrand(pan: string): string {
  const digits = pan.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'visa';
  if (/^5[1-5]/.test(digits) || /^2(2[2-9]|[3-6]\d|7[01]|720)/.test(digits)) return 'mastercard';
  if (/^3[47]/.test(digits)) return 'amex';
  if (/^35(2[89]|[3-8]\d)/.test(digits)) return 'jcb';
  return 'unknown';
}

export function normalizePan(pan: string): string {
  return pan.replace(/\D/g, '');
}

/** Luhn check for card PANs. */
export function isValidLuhn(pan: string): boolean {
  const digits = normalizePan(pan);
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alternate) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function toBeamExpiryYearYy(fullYear: number): number {
  return fullYear % 100;
}
