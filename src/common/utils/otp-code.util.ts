import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseOtpBypassCode(raw: string | undefined): string | undefined {
  const code = raw?.trim();
  if (!code) {
    return undefined;
  }
  if (!/^\d{6}$/.test(code)) {
    throw new Error('OTP_BYPASS_CODE must be exactly 6 digits');
  }
  return code;
}

export function hashOtpCode(code: string, hmacSecret: string): string {
  return createHmac('sha256', hmacSecret).update(code).digest('hex');
}

export function otpHashesMatch(
  storedHash: string,
  providedCode: string,
  hmacSecret: string,
): boolean {
  const providedHash = hashOtpCode(providedCode, hmacSecret);
  const stored = Buffer.from(storedHash, 'utf8');
  const provided = Buffer.from(providedHash, 'utf8');
  if (stored.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(stored, provided);
}

export function otpBypassMatches(providedCode: string, bypassCode: string | undefined): boolean {
  if (!bypassCode) {
    return false;
  }
  const provided = Buffer.from(providedCode, 'utf8');
  const expected = Buffer.from(bypassCode, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export function isAcceptedOtpCode(
  storedHash: string,
  providedCode: string,
  hmacSecret: string,
  bypassCode: string | undefined,
): boolean {
  if (otpBypassMatches(providedCode, bypassCode)) {
    return true;
  }
  return otpHashesMatch(storedHash, providedCode, hmacSecret);
}
